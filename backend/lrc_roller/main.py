from __future__ import annotations

from pathlib import Path
import mimetypes
import platform
import subprocess

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from lrc_roller.adapters import pylrclib_adapter, pyroller_adapter
from lrc_roller.config import Settings, resolve_frontend_dist
from lrc_roller.jobs import JobManager
from lrc_roller.models import (
    ApplyLyricsRequest,
    HealthDependency,
    HealthResponse,
    JobModel,
    LrcCleanseRequest,
    LrcCleanseResponse,
    LrclibGetRequest,
    LrclibGetResponse,
    LrclibIdRequest,
    LrclibSearchRequest,
    LrclibSearchResponse,
    NeteaseResolveRequest,
    NeteaseResolveResponse,
    NeteaseSongSearchRequest,
    NeteaseSearchResponse,
    LyricsRecordModel,
    LocalPathRequest,
    LocalPathResponse,
    ProjectModel,
    RollRequest,
    SaveEditorRequest,
    UploadPlanRequest,
    UploadPlanResponse,
    UploadRunRequest,
    UploadRunResponse,
    RollPreviewResponse,
    AutoRollerRuntimeResponse,
    RuntimeInstallRequest,
    RuntimeSettingsModel,
    RuntimeSettingsUpdateRequest,
    StorageCleanupPlanResponse,
    StorageCleanupPreviewRequest,
    StorageCleanupRunRequest,
    StorageCleanupRunResponse,
    StorageOpenModelRequest,
    StorageOpenRuntimeRequest,
    StorageUsageResponse,
)
from lrc_roller.paths import ensure_data_dirs
from lrc_roller.version import app_version
from lrc_roller.services.lrclib_service import LrclibService
from lrc_roller.services.netease_service import NeteaseService
from lrc_roller.services.project_service import ProjectService
from lrc_roller.services.roller_service import RollerService
from lrc_roller.services.upload_service import UploadService
from lrc_roller.services.runtime_manager import RuntimeManager
from lrc_roller.services.runtime_service import RuntimeService
from lrc_roller.services.storage_service import StorageService
from lrc_roller.services.local_dialog import select_local_path


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    paths = ensure_data_dirs(settings.data_dir)

    app = FastAPI(title="lrc-roller", version=app_version())
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173", f"http://{settings.host}:{settings.port}"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    jobs = JobManager()
    projects = ProjectService(paths["projects"])
    lrclib = LrclibService()
    netease = NeteaseService()
    runtime_manager = RuntimeManager(paths["root"])
    runtime = RuntimeService(data_dir=paths["root"], jobs=jobs, manager=runtime_manager)
    roller = RollerService(
        projects_root=paths["projects"],
        outputs_root=paths["outputs"],
        project_service=projects,
        jobs=jobs,
        settings_provider=runtime.get_settings,
        runtime_manager=runtime_manager,
    )
    upload = UploadService(projects)
    storage = StorageService(data_dir=paths["root"], jobs=jobs, runtime_manager=runtime_manager)

    def open_folder(folder: Path) -> dict[str, str]:
        try:
            system = platform.system().lower()
            if system == "darwin":
                subprocess.Popen(["open", str(folder)])
            elif system == "windows":
                subprocess.Popen(["explorer", str(folder)])
            else:
                subprocess.Popen(["xdg-open", str(folder)])
            return {"status": "ok", "path": str(folder)}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not open folder: {exc}") from exc

    @app.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        pyok, pyver, pydetail = pylrclib_adapter.dependency_status()
        runtime_info = runtime.get_auto_roller_runtime()
        return HealthResponse(
            ok=True,
            port=settings.port,
            data_dir=str(settings.data_dir),
            pylrclib=HealthDependency(available=pyok, version=pyver, detail=pydetail),
            pyroller=HealthDependency(available=runtime_info.available, version=runtime_info.version, detail=runtime_info.detail or runtime_info.runtime_status),
        )

    @app.post("/api/projects", response_model=ProjectModel)
    async def create_project(audio: UploadFile = File(...)) -> ProjectModel:
        try:
            return await projects.create_from_audio(audio)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/projects", response_model=list[ProjectModel])
    def list_projects() -> list[ProjectModel]:
        return projects.list_projects()

    @app.get("/api/projects/{project_id}", response_model=ProjectModel)
    def get_project(project_id: str) -> ProjectModel:
        try:
            return projects.get(project_id, touch=True)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc


    @app.get("/api/projects/{project_id}/audio")
    def get_project_audio(project_id: str) -> FileResponse:
        try:
            project = projects.get(project_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if not project.audio_path:
            raise HTTPException(status_code=404, detail="Project has no audio file")
        audio_path = Path(project.audio_path)
        if not audio_path.exists():
            raise HTTPException(status_code=404, detail="Project audio file is missing")
        media_type = mimetypes.guess_type(audio_path.name)[0] or "application/octet-stream"
        return FileResponse(audio_path, filename=project.audio_name or audio_path.name, media_type=media_type)


    @app.post("/api/projects/{project_id}/open-folder")
    def open_project_folder(project_id: str) -> dict[str, str]:
        try:
            folder = projects.project_folder(project_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return open_folder(folder)

    @app.post("/api/projects/{project_id}/lyrics", response_model=ProjectModel)
    def apply_lyrics(project_id: str, request: ApplyLyricsRequest) -> ProjectModel:
        try:
            return projects.apply_lyrics(project_id, request)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/projects/{project_id}/editor", response_model=ProjectModel)
    def save_editor(project_id: str, request: SaveEditorRequest) -> ProjectModel:
        try:
            return projects.save_editor(project_id, request)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/lrclib/search", response_model=LrclibSearchResponse)
    def lrclib_search(request: LrclibSearchRequest) -> LrclibSearchResponse:
        try:
            return lrclib.search(request)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/lrclib/get", response_model=LrclibGetResponse)
    def lrclib_get(request: LrclibGetRequest) -> LrclibGetResponse:
        try:
            return lrclib.get_cached_then_external(request)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/lrclib/id", response_model=LyricsRecordModel | None)
    def lrclib_get_by_id(request: LrclibIdRequest) -> LyricsRecordModel | None:
        try:
            return lrclib.get_by_id(request)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/netease/search", response_model=NeteaseSearchResponse)
    def netease_search(request: NeteaseSongSearchRequest) -> NeteaseSearchResponse:
        try:
            return netease.search(request)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/netease/resolve", response_model=NeteaseResolveResponse)
    def netease_resolve(request: NeteaseResolveRequest) -> NeteaseResolveResponse:
        try:
            return netease.resolve(request.value)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


    @app.get("/api/netease/audio/{song_id}")
    def netease_audio(song_id: int, range_header: str | None = Header(default=None, alias="Range")) -> StreamingResponse:
        try:
            upstream = netease.open_audio(song_id, range_header=range_header)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        def stream_chunks():
            try:
                while True:
                    chunk = upstream.read(1024 * 256)
                    if not chunk:
                        break
                    yield chunk
            finally:
                upstream.close()

        media_type = upstream.headers.get_content_type() or "audio/mpeg"
        headers = {
            "Accept-Ranges": upstream.headers.get("Accept-Ranges", "bytes"),
            "Cache-Control": "no-store",
        }
        for header_name in ("Content-Length", "Content-Range"):
            value = upstream.headers.get(header_name)
            if value:
                headers[header_name] = value
        status_code = getattr(upstream, "status", 200) or 200
        return StreamingResponse(stream_chunks(), status_code=status_code, media_type=media_type, headers=headers)

    @app.post("/api/lrc/cleanse", response_model=LrcCleanseResponse)
    def lrc_cleanse(request: LrcCleanseRequest) -> LrcCleanseResponse:
        try:
            return lrclib.cleanse_lrc_text(request)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/projects/{project_id}/roll/preview", response_model=RollPreviewResponse)
    def roll_preview(project_id: str, request: RollRequest) -> RollPreviewResponse:
        try:
            return roller.preview(project_id, request)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/projects/{project_id}/roll", response_model=JobModel)
    def roll(project_id: str, request: RollRequest) -> JobModel:
        try:
            return roller.roll(project_id, request)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/jobs", response_model=list[JobModel])
    def list_jobs() -> list[JobModel]:
        return jobs.list()

    @app.post("/api/jobs/{job_id}/cancel", response_model=JobModel)
    def cancel_job(job_id: str) -> JobModel:
        try:
            return jobs.cancel(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=f"Job not found: {job_id}") from exc

    @app.post("/api/jobs/{job_id}/open-folder")
    def open_job_folder(job_id: str) -> dict[str, str]:
        try:
            job = jobs.get(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=f"Job not found: {job_id}") from exc
        if not job.project_id:
            raise HTTPException(status_code=400, detail="This job is not attached to a project folder.")
        try:
            folder = projects.project_folder(job.project_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return open_folder(folder)

    @app.get("/api/jobs/{job_id}", response_model=JobModel)
    def get_job(job_id: str) -> JobModel:
        try:
            return jobs.get(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=f"Job not found: {job_id}") from exc


    @app.get("/api/settings", response_model=RuntimeSettingsModel)
    def get_settings() -> RuntimeSettingsModel:
        return runtime.get_settings()

    @app.post("/api/local/select-path", response_model=LocalPathResponse)
    def select_path(request: LocalPathRequest) -> LocalPathResponse:
        try:
            selected = select_local_path(
                mode=request.mode,
                title=request.title,
                initial_path=request.initial_path,
            )
            return LocalPathResponse(path=selected, canceled=not bool(selected))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


    @app.post("/api/settings", response_model=RuntimeSettingsModel)
    def update_settings(request: RuntimeSettingsUpdateRequest) -> RuntimeSettingsModel:
        return runtime.update_settings(request)

    @app.post("/api/settings/reset-defaults", response_model=RuntimeSettingsModel)
    def reset_settings_defaults() -> RuntimeSettingsModel:
        return runtime.reset_settings_defaults()

    @app.get("/api/runtime/auto-roller", response_model=AutoRollerRuntimeResponse)
    def auto_roller_runtime() -> AutoRollerRuntimeResponse:
        return runtime.get_auto_roller_runtime()

    @app.post("/api/runtime/auto-roller/settings", response_model=RuntimeSettingsModel)
    def update_auto_roller_settings(request: RuntimeSettingsUpdateRequest) -> RuntimeSettingsModel:
        return runtime.update_settings(request)

    @app.post("/api/runtime/auto-roller/doctor", response_model=JobModel)
    def run_auto_roller_doctor() -> JobModel:
        try:
            return runtime.run_doctor()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/runtime/auto-roller/install", response_model=JobModel)
    def run_auto_roller_install(request: RuntimeInstallRequest) -> JobModel:
        try:
            return runtime.run_install(request)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/projects/{project_id}/upload/plan", response_model=UploadPlanResponse)
    def upload_plan(project_id: str, request: UploadPlanRequest) -> UploadPlanResponse:
        try:
            return upload.plan(project_id, request)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/projects/{project_id}/upload/run", response_model=UploadRunResponse)
    def upload_run(project_id: str, request: UploadRunRequest) -> UploadRunResponse:
        try:
            return upload.run(project_id, request)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc



    @app.post("/api/storage/projects/open-folder")
    def open_projects_folder() -> dict[str, str]:
        folder = paths["projects"]
        folder.mkdir(parents=True, exist_ok=True)
        return open_folder(folder)

    @app.get("/api/storage/usage", response_model=StorageUsageResponse)
    def storage_usage() -> StorageUsageResponse:
        return storage.usage()

    @app.post("/api/storage/models/open-folder")
    def open_model_folder(request: StorageOpenModelRequest) -> dict[str, str]:
        try:
            return open_folder(storage.model_item_path(request.model_id))
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/storage/runtimes/open-folder")
    def open_runtime_folder(request: StorageOpenRuntimeRequest) -> dict[str, str]:
        try:
            return open_folder(storage.runtime_item_path(request.runtime_id))
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/storage/cleanup/preview", response_model=StorageCleanupPlanResponse)
    def storage_cleanup_preview(request: StorageCleanupPreviewRequest) -> StorageCleanupPlanResponse:
        try:
            return storage.preview(request)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/storage/cleanup/run", response_model=StorageCleanupRunResponse)
    def storage_cleanup_run(request: StorageCleanupRunRequest) -> StorageCleanupRunResponse:
        try:
            return storage.run(request)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    frontend_dist = resolve_frontend_dist(settings)
    if frontend_dist and frontend_dist.exists():
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

    return app


app = create_app()
