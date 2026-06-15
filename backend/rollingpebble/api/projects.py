from __future__ import annotations

import mimetypes

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from rollingpebble.api.context import AppServices, async_service_call, open_folder, service_call, text_detail
from rollingpebble.models import ApplyLyricsRequest, ProjectModel, SaveEditorRequest
from rollingpebble.storage.files import resolve_audio_path


def create_projects_router(services: AppServices) -> APIRouter:
    router = APIRouter()

    @router.post("/api/projects", response_model=ProjectModel)
    async def create_project(audio: UploadFile = File(...)) -> ProjectModel:
        settings = services.runtime.get_settings()
        return await async_service_call(lambda: services.projects.create_from_audio(audio, settings=settings))

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
        service_call(lambda: services.projects.delete_project(project_id))
        return {"deleted": project_id}

    return router
