from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from rollingpebble.api.context import AppServices, async_service_call, service_call, text_detail
from rollingpebble.config import resolve_frontend_dist
from rollingpebble.models import (
    LocalPathRequest,
    LocalPathResponse,
    RuntimeSettingsModel,
    RuntimeSettingsUpdateRequest,
)
from rollingpebble.services.local_dialog import select_local_path


def create_settings_router(services: AppServices) -> APIRouter:
    router = APIRouter()

    def custom_workspace_bg_path() -> Path | None:
        path = services.settings.data_dir / "workspace-bg"
        return path if path.exists() else None

    def default_workspace_bg_path() -> Path | None:
        repo_root = Path(__file__).resolve().parent.parent.parent.parent
        candidates = [
            resolve_frontend_dist(services.settings),
            Path.cwd() / "frontend" / "dist",
            Path.cwd() / "frontend" / "public",
            repo_root / "frontend" / "dist",
            repo_root / "frontend" / "public",
        ]
        seen: set[Path] = set()
        for candidate in candidates:
            if candidate is None:
                continue
            candidate = candidate.resolve()
            if candidate in seen:
                continue
            seen.add(candidate)
            default_path = candidate / "img" / "rollingpebble-workspace-bg.webp"
            if default_path.exists():
                return default_path
        return None

    def workspace_bg_path() -> Path | None:
        return custom_workspace_bg_path() or default_workspace_bg_path()

    @router.get("/api/settings", response_model=RuntimeSettingsModel)
    def get_settings() -> RuntimeSettingsModel:
        return services.runtime.get_settings()

    @router.post("/api/local/select-path", response_model=LocalPathResponse)
    def select_path(request: LocalPathRequest) -> LocalPathResponse:
        def select() -> LocalPathResponse:
            selected = select_local_path(
                mode=request.mode,
                title=request.title,
                initial_path=request.initial_path,
            )
            return LocalPathResponse(path=selected, canceled=not bool(selected))

        return service_call(select)

    @router.post("/api/settings", response_model=RuntimeSettingsModel)
    def update_settings(request: RuntimeSettingsUpdateRequest) -> RuntimeSettingsModel:
        return services.runtime.update_settings(request)

    @router.post("/api/settings/reset-defaults", response_model=RuntimeSettingsModel)
    def reset_settings_defaults() -> RuntimeSettingsModel:
        return services.runtime.reset_settings_defaults()

    @router.post("/api/settings/workspace-bg")
    async def upload_workspace_bg(bg: UploadFile = File(...)) -> dict[str, str]:
        async def upload() -> dict[str, str]:
            path = services.settings.data_dir / "workspace-bg"
            path.write_bytes(await bg.read())
            return {"ok": "true"}

        return await async_service_call(upload)

    @router.delete("/api/settings/workspace-bg")
    def delete_workspace_bg() -> dict[str, str]:
        path = services.settings.data_dir / "workspace-bg"
        if path.exists():
            path.unlink()
        return {"ok": "true"}

    @router.get("/api/settings/workspace-bg/status")
    def workspace_bg_status() -> dict[str, bool | str]:
        custom = custom_workspace_bg_path() is not None
        default = default_workspace_bg_path() is not None
        return {
            "available": custom or default,
            "custom": custom,
            "source": "custom" if custom else "default" if default else "none",
        }

    @router.get("/api/settings/workspace-bg")
    def get_workspace_bg() -> FileResponse:
        path = workspace_bg_path()
        if path is None:
            raise HTTPException(status_code=404, detail=text_detail("No background available."))
        media_type, _ = mimetypes.guess_type(path.name)
        return FileResponse(
            path,
            media_type=media_type or "image/png",
            headers={"Cache-Control": "no-cache"},
        )

    return router
