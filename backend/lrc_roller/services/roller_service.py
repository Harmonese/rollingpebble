from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from lrc_roller.adapters.pyroller_adapter import (
    artifacts_for,
    build_pyroller_command,
    command_text,
    default_artifacts_dir,
    normalize_stages,
    normalized_stage_text,
)
from lrc_roller.jobs import JobManager
from lrc_roller.models import JobModel, RollPreviewResponse, RollRequest, RuntimeSettingsModel
from lrc_roller.services.project_service import ProjectService
from lrc_roller.storage.files import PLAIN_NAME, PYROLLER_NAME, write_text

_ALLOWED_TRANSCRIBERS: dict[str, set[str]] = {
    "zh": {"faster_whisper", "mms_phonetic"},
    "en": {"faster_whisper"},
    "mul": {"faster_whisper", "wav2vec2_phoneme"},
}
_ALLOWED_TRANSCRIBER_DEVICES = {"", "cpu", "cuda"}

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
        outputs_root: Path,
        project_service: ProjectService,
        jobs: JobManager,
        settings_provider: Callable[[], RuntimeSettingsModel] | None = None,
    ) -> None:
        self.projects_root = projects_root
        self.outputs_root = outputs_root
        self.project_service = project_service
        self.jobs = jobs
        self.settings_provider = settings_provider

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
        use_default("transcriber_model_path", "auto_timing_model_store")
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
            if str(data.get("transcriber_device") or "") not in _ALLOWED_TRANSCRIBER_DEVICES:
                # faster-whisper/ctranslate2 does not accept PyTorch's mps device.
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
        if needs_audio and not project.audio_path:
            raise ValueError("Project has no audio file")
        root = self.projects_root / project_id
        audio_path = Path(project.audio_path) if project.audio_path else root / "audio"
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
                    warnings.append(f"Missing {artifacts[key].name}; run Quick or Full once before realigning.")
        if first_stage == "w" and not artifacts["alignment_result"].exists():
            warnings.append("Missing alignment_result.json; run an alignment step before rewriting output.")
        return warnings

    def preview(self, project_id: str, request: RollRequest) -> RollPreviewResponse:
        timing_plain = self.project_service.plain_lyrics_for_timing(project_id)
        request = self._effective_request(request)
        audio_path, lyrics_path, output_path, intermediate_dir, artifacts_dir = self._paths_for_project(project_id, str(request.stages))
        command = build_pyroller_command(
            audio_path=audio_path,
            lyrics_path=lyrics_path,
            output_path=output_path,
            intermediate_dir=intermediate_dir,
            artifacts_dir=artifacts_dir,
            request=request,
        )
        warnings: list[str] = []
        if "p" in set(normalize_stages(request.stages)) and not timing_plain.strip():
            warnings.append("No lyric lines are saved for this project yet. Metadata-only LRC headers are ignored.")
        elif timing_plain.strip():
            write_text(self.projects_root, project_id, PLAIN_NAME, timing_plain)
        warnings.extend(self._artifact_warnings(str(request.stages), artifacts_dir))
        return RollPreviewResponse(
            command=command,
            command_text=command_text(command),
            warnings=warnings,
            output_path=str(output_path),
            intermediate_dir=str(intermediate_dir),
        )

    def roll(self, project_id: str, request: RollRequest) -> JobModel:
        request = self._effective_request(request)
        project = self.project_service.get(project_id)
        stages = set(normalize_stages(request.stages))
        if stages.intersection({"s", "f", "t"}) and not project.audio_path:
            raise ValueError("Project has no audio file")
        timing_plain = self.project_service.plain_lyrics_for_timing(project_id)
        if "p" in stages and not timing_plain.strip():
            raise ValueError("Project has no lyric lines. Import or paste real lyrics before starting automatic timing; metadata-only LRC headers are ignored.")

        root = self.projects_root / project_id
        audio_path = Path(project.audio_path) if project.audio_path else root / "audio"
        lyrics_path = write_text(self.projects_root, project_id, PLAIN_NAME, timing_plain) if timing_plain.strip() else root / PLAIN_NAME
        output_path = root / PYROLLER_NAME
        intermediate_dir = root / "intermediate"
        artifacts_dir = default_artifacts_dir(root)
        intermediate_dir.mkdir(parents=True, exist_ok=True)
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        artifact_warnings = self._artifact_warnings(str(request.stages), artifacts_dir)
        if artifact_warnings:
            raise ValueError(" ".join(artifact_warnings))
        command = build_pyroller_command(
            audio_path=audio_path,
            lyrics_path=lyrics_path,
            output_path=output_path,
            intermediate_dir=intermediate_dir,
            artifacts_dir=artifacts_dir,
            request=request,
        )

        def on_success() -> dict:
            if not output_path.exists():
                raise FileNotFoundError(f"Auto timing did not create {output_path}")
            synced = output_path.read_text(encoding="utf-8")
            updated = self.project_service.write_pyroller_result(project_id, synced)
            return {
                "project_id": project_id,
                "synced_lyrics": updated.synced_lyrics,
                "plain_lyrics": updated.plain_lyrics,
                "raw_synced_lyrics": synced,
                "output_path": str(output_path),
                "artifacts_dir": str(artifacts_dir),
            }

        return self.jobs.create_subprocess_job(
            kind="auto-timing",
            project_id=project_id,
            command=command,
            cwd=root,
            on_success=on_success,
        )
