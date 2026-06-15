from __future__ import annotations

from fastapi import APIRouter

from rollingpebble.adapters import pylrclib_adapter
from rollingpebble.api.context import AppServices
from rollingpebble.models import HealthDependency, HealthResponse


def create_health_router(services: AppServices) -> APIRouter:
    router = APIRouter()

    @router.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        pyok, pyver, pydetail = pylrclib_adapter.dependency_status()
        runtime_info = services.runtime.get_auto_roller_runtime()
        return HealthResponse(
            ok=True,
            port=services.settings.port,
            data_dir=str(services.settings.data_dir),
            pylrclib=HealthDependency(available=pyok, version=pyver, detail=pydetail),
            pyroller=HealthDependency(
                available=runtime_info.available,
                version=runtime_info.version,
                detail=runtime_info.detail or runtime_info.runtime_status,
            ),
        )

    return router
