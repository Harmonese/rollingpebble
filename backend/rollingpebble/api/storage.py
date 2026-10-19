from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from rollingpebble.api.context import open_folder, service_call
from rollingpebble.models import StorageUsageResponse
from rollingpebble.services.storage_migration import relocate


class RelocateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str


def create_storage_router(services):
    router = APIRouter()

    def exclusive(action):
        if not services.jobs.resource_lock.acquire(blocking=False):
            raise RuntimeError("Auto Timing resources are busy")
        try:
            return action()
        finally:
            services.jobs.resource_lock.release()

    @router.get("/api/storage/usage", response_model=StorageUsageResponse)
    def usage():
        return services.storage.usage()

    @router.post("/api/storage/open-folder")
    def open_root():
        return service_call(lambda: open_folder(services.storage.data_dir))

    @router.post("/api/storage/cache/clear", response_model=StorageUsageResponse)
    def clear():
        return service_call(lambda: exclusive(services.storage.clear_cache))

    @router.post("/api/storage/relocate", response_model=StorageUsageResponse)
    def move(request: RelocateRequest):
        def perform():
            services.storage.relocating = True
            services.storage.migration = {"status": "moving", "target": request.path}
            try:
                relocate(services.storage, request.path, services.apply_storage_layout)
                services.storage.migration = {"status": "idle"}
                return services.storage.usage()
            except Exception:
                services.storage.migration = {"status": "failed", "target": request.path}
                raise
            finally:
                services.storage.relocating = False
        return service_call(lambda: exclusive(perform))

    return router
