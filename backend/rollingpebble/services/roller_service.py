from __future__ import annotations

import json
import shutil
from collections.abc import Callable
from pathlib import Path

from rollingpebble.adapters.pyroller_adapter import (
    PyRollerProtocolClient,
    artifacts_for,
    build_pyroller_batch_command,
    build_pyroller_batch_request,
    build_pyroller_request,
    build_pyroller_env,
    command_text,
    default_artifacts_dir,
    ensure_private_work_dir,
    normalize_stages,
    normalized_stage_text,
    write_protocol_request,
)
from rollingpebble import job_kinds
from rollingpebble.jobs import JobManager
from rollingpebble.models import BatchRollRequest, JobModel, RollPreviewResponse, RollRequest, RuntimeSettingsModel
from rollingpebble.messages import message_from_text
from rollingpebble.runtime.reports import final_report_or_plain_json, report_artifact_paths
from rollingpebble.services.project_service import ProjectService
from rollingpebble.runtime.manager import RuntimeManager
from rollingpebble.storage.files import PLAIN_NAME, PYROLLER_NAME, resolve_audio_path, write_text

_ALLOWED_TRANSCRIBERS: dict[str, set[str]] = {
    "zh": {"faster_whisper", "mms_phonetic"},
    "en": {"faster_whisper"},
    "mul": {"faster_whisper", "wav2vec2_phoneme"},
}
_ALLOWED_TRANSCRIBER_DEVICES = {"", "cpu", "cuda", "mps"}

_TRANSCRIBER_FIELDS = (
    "transcriber_backend",
    "transcriber_device",
    "transcriber_model_name",
    "transcriber_model_path",
    "transcriber_local_files_only",
    "transcriber_compute_type",
    "transcriber_batch_size",
    "transcriber_hf_xet",
    "transcriber_hf_proxy",
    "transcriber_hf_etag_timeout",
    "transcriber_hf_download_timeout",
    "transcriber_hf_max_workers",
)
_SPLITTER_FIELDS = (
    "splitter_backend",
    "splitter_demucs_model",
    "splitter_demucs_device",
    "splitter_demucs_jobs",
    "splitter_demucs_overlap",
    "splitter_demucs_segment",
)


def json_manifest_preview(payload: object) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _positive_int(value: object | None) -> int | None:
    if value is None or value == "":
        return None
    number = int(round(float(value)))
    return number if number > 0 else None


class RollerService:
    def __init__(
        self,
        *,
        projects_root: Path,
        project_service: ProjectService,
        jobs: JobManager,
        settings_provider: Callable[[], RuntimeSettingsModel] | None = None,
        runtime_manager: RuntimeManager | None = None,
    ) -> None:
        self.projects_root = projects_root
        self.project_service = project_service
        self.jobs = jobs
        self.settings_provider = settings_provider
        self.runtime_manager = runtime_manager

    def _effective_request(self, request: RollRequest) -> RollRequest:
        settings = self.settings_provider() if self.settings_provider is not None else RuntimeSettingsModel()
        data = request.model_dump()

        def use_default(field: str, settings_field: str, *, empty_string: bool = True) -> None:
            current = data.get(field)
            missing = current is None or (empty_string and isinstance(current, str) and not current.strip())
            if missing:
                value = getattr(settings, settings_field)
                if value is not None and (not isinstance(value, str) or value.strip()):
                    data[field] = value

        # Core defaults. These can still be overridden by the task payload.
        use_default("language", "auto_timing_default_language", empty_string=False)
        use_default("stages", "auto_timing_default_stages")
        use_default("writer_backend", "auto_timing_default_writer_backend")
        use_default("writer_spacing", "auto_timing_default_writer_spacing", empty_string=False)
        use_default("cleanup", "auto_timing_default_cleanup", empty_string=False)
        use_default("log_level", "auto_timing_default_log_level", empty_string=False)

        # Splitter / filter
        use_default("splitter_backend", "auto_timing_splitter_backend")
        use_default("splitter_demucs_model", "auto_timing_splitter_demucs_model")
        use_default("splitter_demucs_device", "auto_timing_splitter_demucs_device")
        use_default("filter_chain", "auto_timing_filter_chain")
        for field, settings_field in (
            ("splitter_demucs_jobs", "auto_timing_splitter_demucs_jobs"),
            ("splitter_demucs_overlap", "auto_timing_splitter_demucs_overlap"),
            ("splitter_demucs_segment", "auto_timing_splitter_demucs_segment"),
        ):
            if data.get(field) is None:
                data[field] = getattr(settings, settings_field)

        # Transcriber and model download
        use_default("transcriber_backend", "auto_timing_transcriber_backend")
        use_default("transcriber_device", "auto_timing_transcriber_device")
        use_default("transcriber_model_name", "auto_timing_transcriber_model_name")
        use_default("transcriber_compute_type", "auto_timing_transcriber_compute_type")
        if data.get("transcriber_batch_size") is None:
            data["transcriber_batch_size"] = settings.auto_timing_transcriber_batch_size
        if data.get("transcriber_local_files_only") is None:
            data["transcriber_local_files_only"] = settings.auto_timing_local_files_only_default
        if data.get("transcriber_hf_xet") is None:
            data["transcriber_hf_xet"] = settings.auto_timing_hf_xet
        use_default("transcriber_hf_proxy", "auto_timing_hf_proxy")
        if data.get("transcriber_hf_etag_timeout") is None:
            data["transcriber_hf_etag_timeout"] = settings.auto_timing_hf_etag_timeout
        if data.get("transcriber_hf_download_timeout") is None:
            data["transcriber_hf_download_timeout"] = settings.auto_timing_hf_download_timeout
        if data.get("transcriber_hf_max_workers") is None:
            data["transcriber_hf_max_workers"] = settings.auto_timing_hf_max_workers
        if data.get("transcriber_vad_filter") is None:
            data["transcriber_vad_filter"] = settings.auto_timing_transcriber_vad_filter

        # Parser / aligner / writer
        use_default("parser_lyrics_encoding", "auto_timing_parser_lyrics_encoding")
        use_default("aligner_backend", "auto_timing_aligner_backend")
        if data.get("aligner_min_gap") is None:
            data["aligner_min_gap"] = settings.auto_timing_aligner_min_gap
        if data.get("aligner_repetition") is None:
            data["aligner_repetition"] = settings.auto_timing_aligner_repetition
        use_default("writer_by_tag", "auto_timing_writer_by_tag")
        use_default("writer_ass_karaoke_tag_type", "auto_timing_writer_ass_karaoke_tag_type")

        # Normalize values that are consumed by strict downstream CLIs/libraries.
        data["stages"] = normalized_stage_text(str(data.get("stages") or settings.auto_timing_default_stages))
        data["transcriber_hf_etag_timeout"] = _positive_int(data.get("transcriber_hf_etag_timeout"))
        data["transcriber_hf_download_timeout"] = _positive_int(data.get("transcriber_hf_download_timeout"))
        data["transcriber_hf_max_workers"] = _positive_int(data.get("transcriber_hf_max_workers"))
        data["transcriber_batch_size"] = _positive_int(data.get("transcriber_batch_size"))
        data["splitter_demucs_jobs"] = _positive_int(data.get("splitter_demucs_jobs"))

        return self._sanitize_effective_request(RollRequest.model_validate(data))

    def _sanitize_effective_request(self, request: RollRequest) -> RollRequest:
        data = request.model_dump()
        stages = set(normalize_stages(request.stages))

        def clear(fields: tuple[str, ...] | list[str]) -> None:
            for field in fields:
                data[field] = None

        if "s" not in stages:
            clear(_SPLITTER_FIELDS)
        if "f" not in stages:
            data["filter_chain"] = None
        if "t" not in stages:
            clear(_TRANSCRIBER_FIELDS)
        else:
            language = str(data.get("language") or "mul")
            backend = str(data.get("transcriber_backend") or "faster_whisper")
            if backend not in _ALLOWED_TRANSCRIBERS.get(language, {"faster_whisper"}):
                backend = "faster_whisper"
                data["transcriber_backend"] = backend
            device = str(data.get("transcriber_device") or "")
            if device not in _ALLOWED_TRANSCRIBER_DEVICES:
                data["transcriber_device"] = "cpu"
            elif backend == "faster_whisper" and device == "mps":
                # faster-whisper/ctranslate2 does not support PyTorch's mps device.
                # Keep MPS available for Torch-based backends such as wav2vec2/mms.
                data["transcriber_device"] = "cpu"
            if backend != "faster_whisper":
                data["transcriber_compute_type"] = None
                data["transcriber_batch_size"] = None
        if "p" not in stages:
            data["parser_lyrics_encoding"] = None
        if "a" not in stages:
            data["aligner_backend"] = None
            data["aligner_min_gap"] = None
            data["aligner_repetition"] = None
        if "w" not in stages:
            data["writer_by_tag"] = None
            data["writer_ass_karaoke_tag_type"] = None
        elif data.get("writer_backend") != "ass_karaoke":
            data["writer_ass_karaoke_tag_type"] = None

        return RollRequest.model_validate(data)

    def _paths_for_project(self, project_id: str, stages_text: str) -> tuple[Path, Path, Path, Path, Path]:
        project = self.project_service.get(project_id)
        stages = set(normalize_stages(stages_text))
        needs_audio = bool(stages.intersection({"s", "f", "t"}))
        audio_path = resolve_audio_path(self.projects_root, project)
        if needs_audio and not audio_path:
            raise ValueError("Project has no audio file")
        root = self.projects_root / project_id
        audio_path = audio_path if audio_path else root / "audio"
        lyrics_path = root / PLAIN_NAME
        output_path = root / PYROLLER_NAME
        intermediate_dir = root / "intermediate"
        artifacts_dir = default_artifacts_dir(root)
        return audio_path, lyrics_path, output_path, intermediate_dir, artifacts_dir

    def _artifact_warnings(self, stages_text: str, artifacts_dir: Path) -> list[str]:
        stages = normalize_stages(stages_text)
        first_stage = stages[0]
        artifacts = artifacts_for(artifacts_dir.parent)
        warnings: list[str] = []
        if first_stage == "a":
            for key in ("timed_units", "parsed_lyrics"):
                if not artifacts[key].exists():
                    warnings.append(f"Missing {artifacts[key].name}. Run a full pipeline first.")
        if first_stage == "w" and not artifacts["alignment_result"].exists():
            warnings.append("Missing alignment_result.json. Run an alignment step first.")
        return warnings

    def _runtime_command_options(self) -> tuple[list[str] | None, Path | None, dict[str, str] | None]:
        settings = self.settings_provider() if self.settings_provider is not None else RuntimeSettingsModel()
        if self.runtime_manager is None:
            return None, None, None
        runtime = self.runtime_manager.active_runtime(settings)
        return (
            self.runtime_manager.command_prefix(settings.auto_roller_profile),
            self.runtime_manager.default_model_store(),
            self.runtime_manager.runtime_env(runtime.venv_path),
        )

    def _runtime_install_running(self) -> bool:
        return job_kinds.has_running_job(self.jobs, job_kinds.RUNTIME_INSTALL)

    def _has_running_job(self, kind: str) -> bool:
        return job_kinds.has_running_job(self.jobs, kind)

    def _engine_job_running(self) -> bool:
        return job_kinds.has_running_job(
            self.jobs,
            job_kinds.AUTO_TIMING,
            job_kinds.BATCH_AUTO_TIMING,
        )

    def preview(self, project_id: str, request: RollRequest) -> RollPreviewResponse:
        timing_plain = self.project_service.plain_lyrics_for_timing(project_id)
        request = self._effective_request(request)
        audio_path, lyrics_path, output_path, intermediate_dir, artifacts_dir = self._paths_for_project(project_id, str(request.stages))
        command_prefix, default_model_store, _runtime_env = self._runtime_command_options()
        preview_request_path = Path("<rollingpebble-job-work-dir>") / "request.json"
        command = PyRollerProtocolClient(command_prefix=command_prefix).run_command(preview_request_path)
        warnings: list[str] = []
        if "p" in set(normalize_stages(request.stages)) and not timing_plain.strip():
            warnings.append("No lyric lines to time. Import or paste lyrics first.")
        warnings.extend(self._artifact_warnings(str(request.stages), artifacts_dir))
        return RollPreviewResponse(
            command=command,
            command_text=command_text(command),
            warnings=warnings,
            warning_messages=[message_from_text(warning) for warning in warnings],
            output_path=str(output_path),
            intermediate_dir=str(intermediate_dir),
        )

    def roll(self, project_id: str, request: RollRequest) -> JobModel:
        if self._runtime_install_running():
            raise RuntimeError("The isolated Auto Timing runtime is being created or repaired. Wait for it to finish before starting Auto Timing.")
        if self._engine_job_running():
            raise RuntimeError("An Auto Timing or Batch job is already running.")
        request = self._effective_request(request)
        project = self.project_service.get(project_id)
        stages = set(normalize_stages(request.stages))
        audio_path = resolve_audio_path(self.projects_root, project)
        if stages.intersection({"s", "f", "t"}) and not audio_path:
            raise ValueError("Project has no audio file")
        timing_plain = self.project_service.plain_lyrics_for_timing(project_id)
        if "p" in stages and not timing_plain.strip():
            raise ValueError("No lyric lines to time. Import or paste lyrics first.")

        root = self.projects_root / project_id
        audio_path = audio_path if audio_path else root / "audio"
        lyrics_path = write_text(self.projects_root, project_id, PLAIN_NAME, timing_plain) if timing_plain.strip() else root / PLAIN_NAME
        output_path = root / PYROLLER_NAME
        intermediate_dir = root / "intermediate"
        artifacts_dir = default_artifacts_dir(root)
        intermediate_dir.mkdir(parents=True, exist_ok=True)
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        artifact_warnings = self._artifact_warnings(str(request.stages), artifacts_dir)
        if artifact_warnings:
            raise ValueError(" ".join(artifact_warnings))
        command_prefix, default_model_store, runtime_env = self._runtime_command_options()
        def on_success(job_model: JobModel) -> dict:
            report = final_report_or_plain_json(job_model, report_type="run_result")
            artifact_paths = report_artifact_paths(report)
            report_output = artifact_paths.get("roller") if isinstance(artifact_paths.get("roller"), str) else None
            if report_output:
                output = Path(report_output)
            else:
                output = output_path
            if not output.exists():
                raise FileNotFoundError(f"Auto timing did not create {output}")
            synced = output.read_text(encoding="utf-8")
            updated = self.project_service.write_pyroller_result(project_id, synced)
            return {
                "project_id": project_id,
                "synced_lyrics": updated.synced_lyrics,
                "plain_lyrics": updated.plain_lyrics,
                "raw_synced_lyrics": synced,
                "output_path": str(output),
                "artifacts_dir": str(artifacts_dir),
                "artifact_paths": artifact_paths,
                "report": report,
            }

        def prepare(_job_id: str, job_work_dir: Path) -> tuple[list[str], Path | None, dict[str, str] | None, Callable[[], None]]:
            request_dir = ensure_private_work_dir(job_work_dir / "pyroller")
            payload = build_pyroller_request(
                audio_path=audio_path,
                lyrics_path=lyrics_path,
                output_path=output_path,
                intermediate_dir=intermediate_dir,
                artifacts_dir=artifacts_dir,
                request=request,
                default_model_store=default_model_store,
            )
            request_path, _request_text = write_protocol_request(payload, request_dir)
            command = PyRollerProtocolClient(command_prefix=command_prefix).run_command(request_path)
            base_env = runtime_env or {}
            env = build_pyroller_env(request, base_env=base_env) or base_env
            return command, root, env, lambda: shutil.rmtree(job_work_dir, ignore_errors=True)

        return self.jobs.create_subprocess_job(
            kind=job_kinds.AUTO_TIMING,
            project_id=project_id,
            command=[],
            cwd=root,
            on_success=on_success,
            prepare=prepare,
        )

    # -- batch ----------------------------------------------------------------

    def preview_batch(self, request: BatchRollRequest) -> dict:
        effective = self._effective_request(request)
        tasks = self._build_batch_tasks(request.project_ids, effective)
        default_model_store = self.runtime_manager.default_model_store() if self.runtime_manager is not None else None
        manifest_text = json_manifest_preview(tasks)
        payload = build_pyroller_batch_request(
            effective,
            tasks,
            manifest_path=Path("<rollingpebble-job-work-dir>") / "manifest.json",
            intermediate_dir=Path("<rollingpebble-job-work-dir>") / "intermediate",
            default_model_store=str(default_model_store) if default_model_store else None,
        )
        request_text = json_manifest_preview(payload)
        return {
            "project_count": len(tasks),
            "projects": [t.get("id", "") for t in tasks],
            "manifest": request_text,
            "tasks_manifest": manifest_text,
            "warnings": [],
        }

    def run_batch(self, request: BatchRollRequest) -> JobModel:
        if self._has_running_job(job_kinds.AUTO_TIMING) or self._has_running_job(job_kinds.BATCH_AUTO_TIMING):
            raise RuntimeError("An Auto Timing or Batch job is already running.")
        if self.runtime_manager is None:
            raise RuntimeError("Isolated Auto Timing runtime is not configured.")
        settings = self.settings_provider() if self.settings_provider is not None else RuntimeSettingsModel()
        runtime = self.runtime_manager.active_runtime(settings)
        if not runtime.ready:
            raise RuntimeError("Isolated Auto Timing runtime is not ready.")

        effective = self._effective_request(request)
        tasks = self._build_batch_tasks(request.project_ids, effective)

        needs_audio = bool({"s", "f", "t"} & set(normalize_stages(effective.stages)))
        for task in tasks:
            if not needs_audio:
                continue
            audio = task.get("audio")
            if not audio:
                raise FileNotFoundError(f"Project has no audio file: {task.get('id', '')}")
            audio_path = Path(audio)
            if not audio_path.exists():
                raise FileNotFoundError(f"Audio file not found: {audio_path}")

        runtime_env = self.runtime_manager.runtime_env(runtime.venv_path)
        manifest_preview = json_manifest_preview({"tasks": tasks})

        _project_ids = request.project_ids[:]

        def on_success(job_model: JobModel) -> dict:
            report = final_report_or_plain_json(job_model, report_type="batch_result")
            task_results = report.get("results") if isinstance(report, dict) and isinstance(report.get("results"), list) else []
            return {
                "project_ids": _project_ids,
                "manifest": manifest_preview,
                "result": "ok",
                "report": report,
                "task_results": task_results,
            }

        def on_failure(job_model: JobModel) -> dict:
            report = final_report_or_plain_json(job_model, report_type="batch_result")
            task_results = report.get("results") if isinstance(report, dict) and isinstance(report.get("results"), list) else []
            return {
                "project_ids": _project_ids,
                "manifest": manifest_preview,
                "result": "failed",
                "error": job_model.error,
                "report": report,
                "task_results": task_results,
            }

        def prepare(_job_id: str, job_work_dir: Path) -> tuple[list[str], Path | None, dict[str, str] | None, Callable[[], None]]:
            request_dir = ensure_private_work_dir(job_work_dir / "pyroller")
            command, _request_text, _manifest_text = build_pyroller_batch_command(
                effective,
                tasks,
                request_dir=request_dir,
                default_model_store=str(self.runtime_manager.default_model_store()),
            )
            env = build_pyroller_env(effective, base_env=runtime_env) or runtime_env
            return command, runtime.runtime_root, env, lambda: shutil.rmtree(job_work_dir, ignore_errors=True)

        return self.jobs.create_subprocess_job(
            kind=job_kinds.BATCH_AUTO_TIMING,
            project_id=None,
            command=[],
            cwd=runtime.runtime_root,
            on_success=on_success,
            on_failure=on_failure,
            prepare=prepare,
        )

    def _build_batch_tasks(self, project_ids: list[str], request: RollRequest) -> list[dict[str, str]]:
        tasks: list[dict[str, str]] = []
        stage_set = set(normalize_stages(request.stages or "s,f,t,p,a,w"))
        needs_audio = bool({"s", "f", "t"} & stage_set)
        needs_lyrics = "p" in stage_set

        for pid in project_ids:
            project = self.project_service.get(pid)
            task: dict[str, str] = {"id": pid}
            folder = self.project_service.project_folder(pid)

            if needs_audio:
                audio = resolve_audio_path(self.projects_root, project)
                if audio is not None:
                    task["audio"] = str(audio)

            if needs_lyrics:
                plain = folder / PLAIN_NAME
                if plain.exists():
                    task["lyrics"] = str(plain)

            if "w" in stage_set:
                task["output_roller"] = str(folder / PYROLLER_NAME)

            tasks.append(task)
        return tasks
