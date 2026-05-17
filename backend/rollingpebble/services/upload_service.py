from __future__ import annotations

from pathlib import Path

from rollingpebble.adapters.pylrclib_adapter import PylrclibAdapter
from rollingpebble.models import UploadPlanRequest, UploadPlanResponse, UploadRunRequest, UploadRunResponse
from rollingpebble.storage.files import plain_for_timing
from rollingpebble.services.project_service import ProjectService


class UploadService:
    def __init__(self, project_service: ProjectService, adapter: PylrclibAdapter | None = None) -> None:
        self.project_service = project_service
        self.adapter = adapter or PylrclibAdapter()

    def plan(self, project_id: str, request: UploadPlanRequest) -> UploadPlanResponse:
        project = self.project_service.get(project_id)
        meta = request.metadata or project.metadata
        plain = request.plain_lyrics if request.plain_lyrics is not None else project.plain_lyrics
        synced = request.synced_lyrics if request.synced_lyrics is not None else project.synced_lyrics
        clean_plain = plain_for_timing(plain or "", synced or "") if request.allow_derived_plain else plain_for_timing(plain or "", "")
        return self.adapter.build_upload_plan(
            meta=meta,
            plain=clean_plain,
            synced=synced or "",
            mode=request.mode,
            allow_derived_plain=request.allow_derived_plain,
        )

    def run(self, project_id: str, request: UploadRunRequest) -> UploadRunResponse:
        project = self.project_service.get(project_id)
        meta = request.metadata or project.metadata
        plain = request.plain_lyrics if request.plain_lyrics is not None else project.plain_lyrics
        synced = request.synced_lyrics if request.synced_lyrics is not None else project.synced_lyrics
        clean_plain = plain_for_timing(plain or "", synced or "") if request.allow_derived_plain else plain_for_timing(plain or "", "")
        ok, message = self.adapter.upload(
            meta=meta,
            plain=clean_plain,
            synced=synced or "",
            mode=request.mode,
            allow_derived_plain=request.allow_derived_plain,
        )
        return UploadRunResponse(success=ok, message=message)
