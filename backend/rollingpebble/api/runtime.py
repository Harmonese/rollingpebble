from __future__ import annotations

from fastapi import APIRouter, HTTPException

from rollingpebble.api.context import AppServices, service_call
from rollingpebble.runtime.preparation import EnsureRequest
from rollingpebble.models import (
    AutoRollerRuntimeResponse,
)


def create_runtime_router(services: AppServices) -> APIRouter:
    router = APIRouter()

    @router.post("/api/runtime/auto-roller/ensure")
    def ensure_runtime(request: EnsureRequest):
        def ensure():
            try:
                return services.runtime.preparation.ensure(request)
            except RuntimeError as exc:
                if str(exc) == "Auto Timing resources are busy":
                    raise HTTPException(409, {"code": "runtime.resources_busy", "fallback": str(exc)}) from exc
                raise
        return service_call(ensure, default_code="runtime.prepare_failed")

    @router.get("/api/runtime/auto-roller", response_model=AutoRollerRuntimeResponse)
    def auto_roller_runtime() -> AutoRollerRuntimeResponse:
        return services.runtime.get_auto_roller_runtime()

    return router
