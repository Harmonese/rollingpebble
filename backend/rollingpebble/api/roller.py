from __future__ import annotations

from fastapi import APIRouter

from rollingpebble.api.context import AppServices, service_call
from rollingpebble.models import BatchRollRequest, JobModel, RollPreviewResponse, RollRequest


def create_roller_router(services: AppServices) -> APIRouter:
    router = APIRouter()

    @router.post("/api/projects/{project_id}/roll/preview", response_model=RollPreviewResponse)
    def roll_preview(project_id: str, request: RollRequest) -> RollPreviewResponse:
        return service_call(lambda: services.roller.preview(project_id, request))

    @router.post("/api/projects/{project_id}/roll", response_model=JobModel)
    def roll(project_id: str, request: RollRequest) -> JobModel:
        return service_call(lambda: services.roller.roll(project_id, request))

    @router.post("/api/batch/preview")
    def batch_preview(request: BatchRollRequest) -> dict:
        return service_call(lambda: services.roller.preview_batch(request))

    @router.post("/api/batch/roll", response_model=JobModel)
    def batch_roll(request: BatchRollRequest) -> JobModel:
        return service_call(lambda: services.roller.run_batch(request))

    return router
