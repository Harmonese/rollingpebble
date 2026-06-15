from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from rollingpebble.api import include_api_routes
from rollingpebble.api.context import AppServices
from rollingpebble.config import Settings, resolve_frontend_dist
from rollingpebble.jobs import JobManager
from rollingpebble.paths import StorageLayoutRef, ensure_storage_layout
from rollingpebble.services.lrclib_service import LrclibService
from rollingpebble.services.netease_service import NeteaseService
from rollingpebble.services.project_service import ProjectService
from rollingpebble.services.roller_service import RollerService
from rollingpebble.runtime.manager import RuntimeManager
from rollingpebble.runtime.service import RuntimeService
from rollingpebble.services.storage_service import StorageService
from rollingpebble.services.upload_service import UploadService
from rollingpebble.storage.app_settings import SettingsStore
from rollingpebble.version import app_version


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
    initial_runtime_settings = SettingsStore(settings.data_dir).read()
    layout = ensure_storage_layout(settings.data_dir, initial_runtime_settings)
    layout_ref = StorageLayoutRef(layout)

    app = FastAPI(title="rollingpebble", version=app_version())
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
    roller = RollerService(
        projects_root=layout.projects_root,
        project_service=projects,
        jobs=jobs,
        settings_provider=runtime.get_settings,
        runtime_manager=runtime_manager,
    )
    upload = UploadService(projects)
    storage = StorageService(layout=layout_ref.current, jobs=jobs, runtime_manager=runtime_manager)

    def apply_storage_layout() -> None:
        layout_ref.update(storage.layout)
        roller.projects_root = layout_ref.current.projects_root
        runtime.update_layout(layout_ref.current)
        storage.update_layout(layout_ref.current)

    include_api_routes(
        app,
        AppServices(
            settings=settings,
            jobs=jobs,
            projects=projects,
            lrclib=lrclib,
            netease=netease,
            runtime=runtime,
            roller=roller,
            upload=upload,
            storage=storage,
            apply_storage_layout=apply_storage_layout,
        ),
    )
    _mount_frontend(app, settings)
    return app


app = create_app()
