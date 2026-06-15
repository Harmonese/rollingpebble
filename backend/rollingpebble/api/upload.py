from __future__ import annotations

from fastapi import APIRouter

from rollingpebble.api.context import AppServices, service_call
from rollingpebble.models import UploadPlanRequest, UploadPlanResponse, UploadRunRequest, UploadRunResponse


def create_upload_router(services: AppServices) -> APIRouter:
    router = APIRouter()

    @router.post("/api/projects/{project_id}/upload/plan", response_model=UploadPlanResponse)
    def upload_plan(project_id: str, request: UploadPlanRequest) -> UploadPlanResponse:
        return service_call(lambda: services.upload.plan(project_id, request))

    @router.post("/api/projects/{project_id}/upload/run", response_model=UploadRunResponse)
    def upload_run(project_id: str, request: UploadRunRequest) -> UploadRunResponse:
        return service_call(lambda: services.upload.run(project_id, request))

    return router
