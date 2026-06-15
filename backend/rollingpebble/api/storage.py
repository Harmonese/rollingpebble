from __future__ import annotations

from fastapi import APIRouter

from rollingpebble.api.context import AppServices, open_folder, service_call
from rollingpebble.models import (
    StorageCleanupPlanResponse,
    StorageCleanupPreviewRequest,
    StorageCleanupRunRequest,
    StorageCleanupRunResponse,
    StorageMigrateRootRequest,
    StorageMigrateRootResponse,
    StorageOpenModelRequest,
    StorageOpenOtherRequest,
    StorageOpenRuntimeRequest,
    StorageUsageResponse,
)


def create_storage_router(services: AppServices) -> APIRouter:
    router = APIRouter()

    @router.post("/api/storage/projects/open-folder")
    def open_projects_folder() -> dict[str, str]:
        folder = services.storage.layout.projects_root
        folder.mkdir(parents=True, exist_ok=True)
        return open_folder(folder)

    @router.post("/api/storage/open-folder")
    def open_storage_folder() -> dict[str, str]:
        folder = services.storage.layout.app_root
        folder.mkdir(parents=True, exist_ok=True)
        return open_folder(folder)

    @router.get("/api/storage/usage", response_model=StorageUsageResponse)
    def storage_usage() -> StorageUsageResponse:
        return services.storage.usage()

    @router.post("/api/storage/migrate-root", response_model=StorageMigrateRootResponse)
    def storage_migrate_root(request: StorageMigrateRootRequest) -> StorageMigrateRootResponse:
        def migrate() -> StorageMigrateRootResponse:
            result = services.storage.migrate_root(request.root_id, request.target_path)
            services.apply_storage_layout()
            return result

        return service_call(migrate)

    @router.post("/api/storage/models/open-folder")
    def open_model_folder(request: StorageOpenModelRequest) -> dict[str, str]:
        return service_call(lambda: open_folder(services.storage.model_item_path(request.model_id)))

    @router.post("/api/storage/runtimes/open-folder")
    def open_runtime_folder(request: StorageOpenRuntimeRequest) -> dict[str, str]:
        return service_call(lambda: open_folder(services.storage.runtime_item_path(request.runtime_id)))

    @router.post("/api/storage/other/open-folder")
    def open_other_folder(request: StorageOpenOtherRequest) -> dict[str, str]:
        return service_call(lambda: open_folder(services.storage.other_item_open_path(request.relative_path)))

    @router.post("/api/storage/cleanup/preview", response_model=StorageCleanupPlanResponse)
    def storage_cleanup_preview(request: StorageCleanupPreviewRequest) -> StorageCleanupPlanResponse:
        return service_call(lambda: services.storage.preview(request))

    @router.post("/api/storage/cleanup/run", response_model=StorageCleanupRunResponse)
    def storage_cleanup_run(request: StorageCleanupRunRequest) -> StorageCleanupRunResponse:
        return service_call(lambda: services.storage.run(request), not_found=(FileNotFoundError, KeyError))

    return router
