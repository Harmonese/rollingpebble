from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from rollingpebble.auto_timing.service import AutoTimingService
from rollingpebble.auto_timing.store import RunStore
from rollingpebble.api import include_api_routes
from rollingpebble.api.context import AppServices
from rollingpebble.config import Settings, resolve_frontend_dist
from rollingpebble.jobs import JobManager
from rollingpebble.paths import StorageLayoutRef, ensure_storage_layout
from rollingpebble.services.lrclib_service import LrclibService
from rollingpebble.services.netease_service import NeteaseService
from rollingpebble.services.project_service import ProjectService
from rollingpebble.runtime.manager import RuntimeManager
from rollingpebble.runtime.service import RuntimeService
from rollingpebble.services.storage_service import StorageService
from rollingpebble.services.upload_service import UploadService
from rollingpebble.storage.app_settings import SettingsStore
from rollingpebble.version import app_version
from rollingpebble.translation import TranslationService


def _mount_frontend(app: FastAPI, settings: Settings) -> None:
    frontend_dist = resolve_frontend_dist(settings)
    if not frontend_dist or not frontend_dist.exists():
        return

    assets = frontend_dist / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")
    favicons = frontend_dist / "favicons"
    if favicons.exists():
        app.mount("/favicons", StaticFiles(directory=favicons), name="favicons")
    worker = frontend_dist / "worker"
    if worker.exists():
        app.mount("/worker", StaticFiles(directory=worker), name="worker")

    @app.get("/{full_path:path}")
    def spa(full_path: str) -> FileResponse:
        candidate = frontend_dist / full_path
        if full_path and candidate.exists() and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(frontend_dist / "index.html")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    from rollingpebble.storage.transition import begin_layout_transition
    begin_layout_transition(settings.data_dir)
    from rollingpebble.services.storage_migration import finish_relocation
    finish_relocation(settings.data_dir)
    initial_runtime_settings = SettingsStore(settings.data_dir).read()
    # Persist the fresh/upgrade distinction before runtime history is first written.
    SettingsStore(settings.data_dir).write(initial_runtime_settings)
    layout = ensure_storage_layout(settings.data_dir, initial_runtime_settings)
    layout_ref = StorageLayoutRef(layout)

    @asynccontextmanager
    async def lifespan(_app):
        yield
        await translation.close()
        await asyncio.to_thread(auto_timing.close)
        await asyncio.to_thread(runtime.models.close)
        await asyncio.to_thread(runtime.preparation.close)

    app = FastAPI(title="rollingpebble", version=app_version(), lifespan=lifespan)
    write_lock = asyncio.Lock()

    @app.middleware("http")
    async def serialize_writes(request, call_next):
        if storage.relocating and request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            return JSONResponse(status_code=409, content={"detail": {"code": "timing.busy"}})
        if (request.method in {"POST", "PUT", "PATCH", "DELETE"}
                or request.url.path.startswith("/api/projects")
                or request.url.path.endswith("/binding")
                or request.url.path == "/api/auto-timing/models"):
            async with write_lock:
                return await call_next(request)
        return await call_next(request)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            f"http://{settings.host}:{settings.port}",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    jobs = JobManager(work_root=layout.work_root)
    projects = ProjectService(layout_ref=layout_ref)
    lrclib = LrclibService()
    netease = NeteaseService()
    runtime_manager = RuntimeManager(layout)
    runtime = RuntimeService(layout=layout_ref.current, jobs=jobs, manager=runtime_manager)
    auto_timing = AutoTimingService(projects=projects, runtime=runtime, jobs=jobs)
    translation = TranslationService(runtime)
    upload = UploadService(projects)
    storage = StorageService(layout=layout_ref.current, jobs=jobs, runtime_manager=runtime_manager)

    def apply_storage_layout() -> None:
        layout_ref.update(storage.layout)
        runtime.update_layout(layout_ref.current)
        storage.update_layout(layout_ref.current)
        jobs.work_root = layout_ref.current.work_root
        auto_timing.store = RunStore(layout_ref.current.results_root)
        settings.data_dir = layout_ref.current.app_root

    include_api_routes(
        app,
        AppServices(
            settings=settings,
            jobs=jobs,
            projects=projects,
            lrclib=lrclib,
            netease=netease,
            runtime=runtime,
            upload=upload,
            storage=storage,
            apply_storage_layout=apply_storage_layout,
            auto_timing=auto_timing,
            translation=translation,
        ),
    )
    _mount_frontend(app, settings)
    return app


def __getattr__(name):
    # Uvicorn's main:app entry point remains available without opening or
    # migrating the user's data when tests and CLI helpers import create_app.
    if name == "app":
        app = create_app()
        globals()[name] = app
        return app
    raise AttributeError(name)
