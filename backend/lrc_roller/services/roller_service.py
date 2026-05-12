from __future__ import annotations

from pathlib import Path

from lrc_roller.adapters.pyroller_adapter import build_pyroller_command, command_text
from lrc_roller.jobs import JobManager
from collections.abc import Callable

from lrc_roller.models import JobModel, RollPreviewResponse, RollRequest, RuntimeSettingsModel
from lrc_roller.services.project_service import ProjectService
from lrc_roller.storage.files import PLAIN_NAME, PYROLLER_NAME, write_text


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
        if self.settings_provider is None:
            return request
        settings = self.settings_provider()
        data = request.model_dump()
        if not data.get("transcriber_model_path") and settings.auto_timing_model_store.strip():
            data["transcriber_model_path"] = settings.auto_timing_model_store.strip()
        if data.get("transcriber_local_files_only") is None:
            data["transcriber_local_files_only"] = settings.auto_timing_local_files_only_default
        if data.get("transcriber_hf_xet") is None:
            data["transcriber_hf_xet"] = settings.auto_timing_hf_xet
        if not data.get("transcriber_hf_proxy") and settings.auto_timing_hf_proxy.strip():
            data["transcriber_hf_proxy"] = settings.auto_timing_hf_proxy.strip()
        if data.get("transcriber_hf_etag_timeout") is None:
            data["transcriber_hf_etag_timeout"] = settings.auto_timing_hf_etag_timeout
        if data.get("transcriber_hf_download_timeout") is None:
            data["transcriber_hf_download_timeout"] = settings.auto_timing_hf_download_timeout
        if data.get("transcriber_hf_max_workers") is None:
            data["transcriber_hf_max_workers"] = settings.auto_timing_hf_max_workers
        return RollRequest.model_validate(data)

    def _paths_for_project(self, project_id: str) -> tuple[Path, Path, Path, Path]:
        project = self.project_service.get(project_id)
        if not project.audio_path:
            raise ValueError("Project has no audio file")
        root = self.projects_root / project_id
        audio_path = Path(project.audio_path)
        lyrics_path = root / PLAIN_NAME
        output_path = root / PYROLLER_NAME
        intermediate_dir = root / "intermediate"
        return audio_path, lyrics_path, output_path, intermediate_dir

    def preview(self, project_id: str, request: RollRequest) -> RollPreviewResponse:
        project = self.project_service.get(project_id)
        timing_plain = self.project_service.plain_lyrics_for_timing(project_id)
        request = self._effective_request(request)
        audio_path, lyrics_path, output_path, intermediate_dir = self._paths_for_project(project_id)
        command = build_pyroller_command(
            audio_path=audio_path,
            lyrics_path=lyrics_path,
            output_path=output_path,
            intermediate_dir=intermediate_dir,
            request=request,
        )
        warnings: list[str] = []
        if not timing_plain.strip():
            warnings.append("No lyric lines are saved for this project yet. Metadata-only LRC headers are ignored.")
        else:
            write_text(self.projects_root, project_id, PLAIN_NAME, timing_plain)
        if request.stages in {"a,w", "w"}:
            warnings.append("Artifact-only flows are not wired in this UI yet. Use Quick or Full for now.")
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
        if not project.audio_path:
            raise ValueError("Project has no audio file")
        timing_plain = self.project_service.plain_lyrics_for_timing(project_id)
        if not timing_plain.strip():
            raise ValueError("Project has no lyric lines. Import or paste real lyrics before starting automatic timing; metadata-only LRC headers are ignored.")

        root = self.projects_root / project_id
        audio_path = Path(project.audio_path)
        lyrics_path = write_text(self.projects_root, project_id, PLAIN_NAME, timing_plain)
        output_path = root / PYROLLER_NAME
        intermediate_dir = root / "intermediate"
        intermediate_dir.mkdir(parents=True, exist_ok=True)
        command = build_pyroller_command(
            audio_path=audio_path,
            lyrics_path=lyrics_path,
            output_path=output_path,
            intermediate_dir=intermediate_dir,
            request=request,
        )

        def on_success() -> dict:
            if not output_path.exists():
                raise FileNotFoundError(f"Auto timing did not create {output_path}")
            synced = output_path.read_text(encoding="utf-8")
            updated = self.project_service.write_pyroller_result(project_id, synced)
            return {
                "project_id": project_id,
                "synced_lyrics": synced,
                "plain_lyrics": updated.plain_lyrics,
                "output_path": str(output_path),
            }

        return self.jobs.create_subprocess_job(
            kind="auto-timing",
            project_id=project_id,
            command=command,
            cwd=root,
            on_success=on_success,
        )
