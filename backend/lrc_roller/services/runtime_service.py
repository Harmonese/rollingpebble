from __future__ import annotations

import shutil
from pathlib import Path

from lrc_roller.adapters import pyroller_adapter
from lrc_roller.jobs import JobManager
from lrc_roller.models import (
    AutoRollerRuntimeResponse,
    JobModel,
    RuntimeInstallRequest,
    RuntimeSettingsModel,
    RuntimeSettingsUpdateRequest,
)
from lrc_roller.storage.app_settings import SettingsStore, utc_now_iso


class RuntimeService:
    def __init__(self, *, data_dir: Path, jobs: JobManager) -> None:
        self.data_dir = data_dir
        self.jobs = jobs
        self.settings_store = SettingsStore(data_dir)

    def get_auto_roller_runtime(self) -> AutoRollerRuntimeResponse:
        available, version, detail = pyroller_adapter.dependency_status()
        return AutoRollerRuntimeResponse(
            available=available,
            version=version,
            cli_path=pyroller_adapter.cli_path(),
            python_executable=pyroller_adapter.python_executable(),
            data_dir=str(self.data_dir),
            model_store=str(pyroller_adapter.default_model_store()),
            settings=self.settings_store.read(),
            detail=detail,
        )

    def get_settings(self) -> RuntimeSettingsModel:
        return self.settings_store.read()

    def update_settings(self, request: RuntimeSettingsUpdateRequest) -> RuntimeSettingsModel:
        settings = self.settings_store.read()
        for field, value in request.model_dump(exclude_unset=True).items():
            if value is not None or field in {
                "auto_timing_hf_etag_timeout",
                "auto_timing_hf_download_timeout",
                "auto_timing_hf_max_workers",
                "auto_timing_splitter_demucs_jobs",
                "auto_timing_splitter_demucs_overlap",
                "auto_timing_splitter_demucs_segment",
                "auto_timing_transcriber_batch_size",
                "auto_timing_aligner_min_gap",
            }:
                setattr(settings, field, value)
        return self.settings_store.write(settings)

    def run_doctor(self) -> JobModel:
        if shutil.which("py-roller") is None:
            raise RuntimeError("py-roller CLI not found. Install py-roller before running the runtime check.")

        def on_success() -> dict:
            settings = self.settings_store.read()
            settings.last_doctor_status = "passed"
            settings.last_doctor_at = utc_now_iso()
            self.settings_store.write(settings)
            return {"status": "passed", "checked_at": settings.last_doctor_at}

        return self.jobs.create_subprocess_job(
            kind="auto-roller-doctor",
            project_id=None,
            command=["py-roller", "doctor"],
            cwd=None,
            on_success=on_success,
        )

    def run_install(self, request: RuntimeInstallRequest) -> JobModel:
        if shutil.which("py-roller") is None:
            raise RuntimeError(
                "py-roller CLI not found. Run `python -m pip install py-roller` first, or use `lrc-roller setup --profile "
                f"{request.profile}` from the terminal."
            )
        settings = self.settings_store.read()
        settings.auto_roller_profile = request.profile
        settings.last_install_profile = request.profile
        settings.last_install_at = utc_now_iso()
        self.settings_store.write(settings)

        command = ["py-roller", "install", "--profile", request.profile]
        if request.skip_doctor:
            command.append("--skip-doctor")
        if request.dry_run:
            command.append("--dry-run")

        return self.jobs.create_subprocess_job(
            kind="auto-roller-install",
            project_id=None,
            command=command,
            cwd=None,
            on_success=lambda: {"profile": request.profile, "installed_at": utc_now_iso()},
        )
