from __future__ import annotations

from fastapi import APIRouter

from rollingpebble.api.context import AppServices, service_call
from rollingpebble.models import (
    AutoRollerRuntimeResponse,
    JobModel,
    ModelCacheRequest,
    RuntimeInstallRequest,
    RuntimeUpgradeRequest,
)


def create_runtime_router(services: AppServices) -> APIRouter:
    router = APIRouter()

    @router.get("/api/runtime/auto-roller", response_model=AutoRollerRuntimeResponse)
    def auto_roller_runtime() -> AutoRollerRuntimeResponse:
        return services.runtime.get_auto_roller_runtime()

    @router.post("/api/runtime/auto-roller/doctor", response_model=JobModel)
    def run_auto_roller_doctor() -> JobModel:
        return service_call(services.runtime.run_doctor)

    @router.post("/api/runtime/auto-roller/install", response_model=JobModel)
    def run_auto_roller_install(request: RuntimeInstallRequest) -> JobModel:
        return service_call(lambda: services.runtime.run_install(request))

    @router.post("/api/runtime/auto-roller/upgrade", response_model=JobModel)
    def run_auto_roller_upgrade(request: RuntimeUpgradeRequest) -> JobModel:
        return service_call(lambda: services.runtime.run_upgrade(request))

    @router.post("/api/runtime/auto-roller/cache-model", response_model=JobModel)
    def run_auto_roller_cache_model(request: ModelCacheRequest) -> JobModel:
        return service_call(lambda: services.runtime.run_cache_model(request))

    return router
