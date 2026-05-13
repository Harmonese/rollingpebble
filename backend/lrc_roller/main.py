from __future__ import annotations

from pathlib import Path
import platform
import subprocess

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from lrc_roller.adapters import pylrclib_adapter, pyroller_adapter
from lrc_roller.config import Settings, frontend_dist_from_repo
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
)
from lrc_roller.paths import ensure_data_dirs
from lrc_roller.services.lrclib_service import LrclibService
from lrc_roller.services.project_service import ProjectService
from lrc_roller.services.roller_service import RollerService
from lrc_roller.services.upload_service import UploadService
from lrc_roller.services.runtime_service import RuntimeService
from lrc_roller.services.local_dialog import select_local_path


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    paths = ensure_data_dirs(settings.data_dir)

    app = FastAPI(title="lrc-roller", version="0.4.3")
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
    runtime = RuntimeService(data_dir=paths["root"], jobs=jobs)
    roller = RollerService(
        projects_root=paths["projects"],
        outputs_root=paths["outputs"],
        project_service=projects,
        jobs=jobs,
        settings_provider=runtime.get_settings,
    )
    upload = UploadService(projects)

    @app.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        pyok, pyver, pydetail = pylrclib_adapter.dependency_status()
        rok, rver, rdetail = pyroller_adapter.dependency_status()
        return HealthResponse(
            ok=True,
            port=settings.port,
            data_dir=str(settings.data_dir),
            pylrclib=HealthDependency(available=pyok, version=pyver, detail=pydetail),
            pyroller=HealthDependency(available=rok, version=rver, detail=rdetail),
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
        return FileResponse(audio_path, filename=project.audio_name or audio_path.name, media_type="audio/mpeg")


    @app.post("/api/projects/{project_id}/open-folder")
    def open_project_folder(project_id: str) -> dict[str, str]:
        try:
            folder = projects.project_folder(project_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
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
            raise HTTPException(status_code=400, detail=f"Could not open project folder: {exc}") from exc

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

    frontend_dist = settings.frontend_dist or frontend_dist_from_repo()
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
