from __future__ import annotations

import mimetypes
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Request
from fastapi.responses import FileResponse

from rollingpebble.api.context import AppServices, async_service_call, open_folder, service_call, text_detail
from rollingpebble.models import ApplyLyricsRequest, ProjectModel, SaveEditorRequest, WorkspaceSaveRequest, AudioMetadataRequest, MetaModel
from rollingpebble.storage.files import resolve_audio_path
from rollingpebble import job_kinds
from rollingpebble.services.workspace_recovery import WorkspaceRecovery, RecoveryRecord


def create_projects_router(services: AppServices) -> APIRouter:
    router = APIRouter()
    recovery = WorkspaceRecovery(services.projects)

    def check_recovery_origin(request: Request):
        if request.headers.get("sec-fetch-site") == "cross-site":
            raise HTTPException(403)
        origin = request.headers.get("origin")
        allowed = {str(request.base_url).rstrip("/"), "http://localhost:5173", "http://127.0.0.1:5173"}
        if origin and origin not in allowed:
            raise HTTPException(403)
        if request.method != "GET" and request.headers.get("x-rollingpebble-client") != "workspace":
            raise HTTPException(403)

    @router.get("/api/workspace/recovery")
    def read_recovery(request: Request):
        check_recovery_origin(request)
        return service_call(recovery.read)

    @router.put("/api/workspace/recovery")
    def write_recovery(request: Request, record: str = Form(...), audio: UploadFile | None = File(None)):
        check_recovery_origin(request)
        return service_call(lambda: recovery.write(RecoveryRecord.model_validate_json(record), audio))

    @router.delete("/api/workspace/recovery")
    def clear_recovery(request: Request):
        check_recovery_origin(request)
        recovery.clear()
        return {"ok": True}

    @router.get("/api/workspace/recovery/audio/{key}")
    def recovery_audio(request: Request, key: uuid.UUID):
        check_recovery_origin(request)
        return FileResponse(service_call(lambda: recovery.audio(key)))

    @router.post("/api/projects", response_model=ProjectModel)
    async def create_project(audio: UploadFile = File(...)) -> ProjectModel:
        settings = services.runtime.get_settings()
        return await async_service_call(lambda: services.projects.create_from_audio(audio, settings=settings))

    @router.put("/api/projects/drafts/{draft_id}", response_model=ProjectModel)
    async def save_workspace(
        draft_id: str, snapshot: str = Form(...), audio: UploadFile | None = File(None),
    ) -> ProjectModel:
        parsed = service_call(lambda: WorkspaceSaveRequest.model_validate_json(snapshot))
        return await async_service_call(lambda: services.projects.save_workspace(
            draft_id, audio, parsed, settings=services.runtime.get_settings(),
        ))

    @router.post("/api/audio/metadata", response_model=MetaModel)
    def audio_metadata(request: AudioMetadataRequest) -> MetaModel:
        return services.projects.audio_metadata(request.filename, request.metadata, services.runtime.get_settings())

    @router.put("/api/projects/{project_id}/audio", response_model=ProjectModel)
    async def replace_audio(
        project_id: str, snapshot: str = Form(...), audio: UploadFile = File(...),
    ) -> ProjectModel:
        if job_kinds.has_running_job(services.jobs, job_kinds.AUTO_TIMING, job_kinds.BATCH_AUTO_TIMING):
            raise HTTPException(status_code=409, detail=text_detail("An Auto Timing or Batch job is already running."))
        parsed = service_call(lambda: WorkspaceSaveRequest.model_validate_json(snapshot))
        return await async_service_call(lambda: services.projects.replace_workspace_audio(project_id, audio, parsed))

    @router.get("/api/projects", response_model=list[ProjectModel])
    def list_projects() -> list[ProjectModel]:
        return services.projects.list_projects()

    @router.get("/api/projects/{project_id}", response_model=ProjectModel)
    def get_project(project_id: str) -> ProjectModel:
        return service_call(lambda: services.projects.get(project_id, touch=True))

    @router.get("/api/projects/{project_id}/audio")
    def get_project_audio(project_id: str) -> FileResponse:
        project = service_call(lambda: services.projects.get(project_id))
        audio_path = resolve_audio_path(services.projects.projects_root, project)
        if not audio_path:
            raise HTTPException(status_code=404, detail=text_detail("Project has no audio file"))
        if not audio_path.exists():
            raise HTTPException(status_code=404, detail=text_detail("Project audio file is missing"))
        media_type = mimetypes.guess_type(audio_path.name)[0] or "application/octet-stream"
        return FileResponse(audio_path, filename=project.audio_name or audio_path.name, media_type=media_type)

    @router.post("/api/projects/{project_id}/open-folder")
    def open_project_folder(project_id: str) -> dict[str, str]:
        folder = service_call(lambda: services.projects.project_folder(project_id))
        return open_folder(folder)

    @router.post("/api/projects/{project_id}/lyrics", response_model=ProjectModel)
    def apply_lyrics(project_id: str, request: ApplyLyricsRequest) -> ProjectModel:
        return service_call(lambda: services.projects.apply_lyrics(project_id, request))

    @router.post("/api/projects/{project_id}/editor", response_model=ProjectModel)
    def save_editor(project_id: str, request: SaveEditorRequest) -> ProjectModel:
        return service_call(lambda: services.projects.save_editor(project_id, request))

    @router.delete("/api/projects/{project_id}")
    def delete_project(project_id: str) -> dict[str, str]:
        def remove():
            if not services.jobs.resource_lock.acquire(blocking=False):
                raise RuntimeError("Auto Timing resources are busy")
            try:
                services.projects.delete_project(project_id)
            finally:
                services.jobs.resource_lock.release()
        service_call(remove)
        return {"deleted": project_id}

    return router
