from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from rollingpebble.jobs import JobManager
from rollingpebble.models import (
    AutoRollerRuntimeResponse,
    JobModel,
    JobStatus,
    RuntimeInstallRequest,
    RuntimeSettingsModel,
    RuntimeSettingsUpdateRequest,
    RuntimeUpgradeRequest,
    ModelCacheRequest,
)
from rollingpebble.runtime_constants import PYROLLER_RUNTIME_SPEC
from rollingpebble.services.runtime_manager import RuntimeManager
from rollingpebble.storage.app_settings import SettingsStore, utc_now_iso


def _json_from_log_lines(lines: list[str]) -> dict[str, Any] | None:
    text = "\n".join(lines).strip()
    if not text:
        return None
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        payload = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _is_running(job: JobModel) -> bool:
    return job.status in {JobStatus.queued, JobStatus.running}


class RuntimeService:
    def __init__(self, *, data_dir: Path, jobs: JobManager, manager: RuntimeManager | None = None) -> None:
        self.data_dir = data_dir
        self.jobs = jobs
        self.settings_store = SettingsStore(data_dir)
        self.manager = manager or RuntimeManager(data_dir)

    def _has_running_job(self, kind: str) -> bool:
        if not hasattr(self.jobs, "list"):
            return False
        return any(job.kind == kind and _is_running(job) for job in self.jobs.list())

    def get_auto_roller_runtime(self) -> AutoRollerRuntimeResponse:
        settings = self.settings_store.read()
        runtime = self.manager.active_runtime(settings)
        return AutoRollerRuntimeResponse(
            available=runtime.ready,
            version=runtime.version,
            cli_path=" ".join(self.manager.command_prefix(settings.auto_roller_profile)) if runtime.ready else None,
            python_executable=runtime.python_path.as_posix() if runtime.python_path else "",
            data_dir=str(self.data_dir),
            model_store=str(self.manager.default_model_store()),
            settings=settings,
            detail=runtime.detail,
            runtime_id=runtime.runtime_id,
            runtime_status=runtime.status,
            runtime_profile=runtime.profile,
            runtime_root=str(runtime.runtime_root),
            runtime_venv=str(runtime.venv_path),
            runtime_python=str(runtime.python_path),
            runtime_source=runtime.source,
            runtime_requirement=PYROLLER_RUNTIME_SPEC,
            doctor_report=runtime.doctor_report,
            install_report=runtime.install_report,
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

    def reset_settings_defaults(self) -> RuntimeSettingsModel:
        result = self.settings_store.reset_defaults(preserve_runtime_history=True)
        bg_path = self.settings_store.path.parent / "workspace-bg"
        if bg_path.exists():
            bg_path.unlink()
        return result

    def _capture_doctor_report(self, profile: str) -> dict[str, Any] | None:
        try:
            runtime = self.manager.inspect(profile)
            if not runtime.ready:
                return None
            result = subprocess.run(
                self.manager.doctor_command(profile),
                cwd=str(runtime.runtime_root),
                check=False,
                capture_output=True,
                text=True,
                timeout=60,
                env=self.manager.runtime_env(runtime.venv_path),
            )
            return _json_from_log_lines(result.stdout.splitlines())
        except Exception:
            return None

    def _store_doctor_result(self, profile: str, doctor_report: dict[str, Any] | None, *, succeeded: bool) -> dict[str, Any]:
        current = self.settings_store.read()
        ok = bool(doctor_report.get("ok")) if doctor_report is not None else succeeded
        current.last_doctor_status = "passed" if ok else "failed"
        current.last_doctor_at = utc_now_iso()
        self.settings_store.write(current)
        self.manager.update_metadata(
            profile,
            {
                "last_doctor_status": "ok" if ok else "failed",
                "last_doctor_at": current.last_doctor_at,
                "doctor_report": doctor_report,
            },
        )
        return {
            "status": current.last_doctor_status,
            "checked_at": current.last_doctor_at,
            "runtime_id": self.manager.runtime_id(profile),
            "doctor_report": doctor_report,
        }

    def run_doctor(self) -> JobModel:
        if self._has_running_job("auto-roller-runtime-install"):
            raise RuntimeError("Runtime installation is already running. Wait for it to finish before running Runtime Check.")
        if self._has_running_job("auto-roller-doctor"):
            raise RuntimeError("Runtime Check is already running.")
        settings = self.settings_store.read()
        runtime = self.manager.active_runtime(settings)
        if not runtime.doctorable:
            raise RuntimeError("Isolated Auto Timing runtime is not ready. Create or repair it before running Runtime Check.")

        def on_success(job_model: JobModel) -> dict:
            doctor_report = _json_from_log_lines(job_model.logs) or self._capture_doctor_report(settings.auto_roller_profile)
            return self._store_doctor_result(settings.auto_roller_profile, doctor_report, succeeded=True)

        def on_failure(job_model: JobModel) -> dict:
            doctor_report = _json_from_log_lines(job_model.logs)
            return self._store_doctor_result(settings.auto_roller_profile, doctor_report, succeeded=False)

        return self.jobs.create_subprocess_job(
            kind="auto-roller-doctor",
            project_id=None,
            command=self.manager.doctor_command(settings.auto_roller_profile),
            cwd=runtime.runtime_root,
            on_success=on_success,
            on_failure=on_failure,
            env=self.manager.runtime_env(runtime.venv_path),
        )

    def run_upgrade(self, request: RuntimeUpgradeRequest) -> JobModel:
        if self._has_running_job("auto-timing"):
            raise RuntimeError("Auto Timing is running. Cancel or wait for it before upgrading the runtime.")
        if self._has_running_job("auto-roller-runtime-install"):
            raise RuntimeError("Runtime installation is already running.")
        if self._has_running_job("auto-roller-runtime-upgrade"):
            raise RuntimeError("Runtime upgrade is already running.")
        settings = self.settings_store.read()
        runtime = self.manager.active_runtime(settings)
        if not runtime.ready:
            raise RuntimeError("Isolated Auto Timing runtime is not ready. Create or repair it before upgrading.")

        def finalize(job_model: JobModel, *, succeeded: bool) -> dict:
            new_version: str | None = None
            if succeeded:
                info = self.manager.inspect(settings.auto_roller_profile)
                new_version = self.manager._version_from_python(info.python_path)  # noqa: SLF001
                if new_version:
                    self.manager.update_metadata(
                        settings.auto_roller_profile,
                        {"pyroller_version": new_version, "last_upgrade_status": "passed", "last_upgrade_at": utc_now_iso()},
                    )
            return {
                "profile": request.profile,
                "succeeded": succeeded,
                "new_version": new_version,
                "message": f"py-roller upgraded to {new_version}." if succeeded and new_version
                else "py-roller upgraded successfully." if succeeded
                else f"Upgrade failed: {job_model.error or 'unknown error'}",
            }

        return self.jobs.create_subprocess_job(
            kind="auto-roller-runtime-upgrade",
            project_id=None,
            command=self.manager.upgrade_command(settings.auto_roller_profile),
            cwd=runtime.runtime_root,
            on_success=lambda job: finalize(job, succeeded=True),
            on_failure=lambda job: finalize(job, succeeded=False),
            env=self.manager.runtime_env(runtime.venv_path),
        )

    def run_cache_model(self, request: ModelCacheRequest) -> JobModel:
        if self._has_running_job("auto-timing"):
            raise RuntimeError("Auto Timing is running. Cancel or wait for it before caching a model.")
        if self._has_running_job("auto-roller-runtime-install"):
            raise RuntimeError("Runtime installation is already running.")
        if self._has_running_job("auto-roller-runtime-cache-model"):
            raise RuntimeError("Model caching is already running.")
        settings = self.settings_store.read()
        runtime = self.manager.active_runtime(settings)
        if not runtime.ready:
            raise RuntimeError("Isolated Auto Timing runtime is not ready.")

        def finalize(job_model: JobModel, *, succeeded: bool) -> dict:
            return {
                "succeeded": succeeded,
                "message": "Model cached successfully." if succeeded
                else f"Model cache failed: {job_model.error or 'unknown error'}",
            }

        return self.jobs.create_subprocess_job(
            kind="auto-roller-runtime-cache-model",
            project_id=None,
            command=self.manager.cache_model_command(
                settings.auto_roller_profile,
                language=request.language,
                backend=request.transcriber_backend or settings.auto_timing_transcriber_backend,
                model_name=request.transcriber_model_name or settings.auto_timing_transcriber_model_name,
                model_path=request.transcriber_model_path or settings.auto_timing_model_store or None,
            ),
            cwd=runtime.runtime_root,
            on_success=lambda job: finalize(job, succeeded=True),
            on_failure=lambda job: finalize(job, succeeded=False),
            env=self.manager.runtime_env(runtime.venv_path),
        )

    def run_install(self, request: RuntimeInstallRequest) -> JobModel:
        if self._has_running_job("auto-timing"):
            raise RuntimeError("Auto Timing is running. Cancel or wait for it before repairing the runtime.")
        if self._has_running_job("auto-roller-runtime-install"):
            raise RuntimeError("Runtime installation is already running.")
        if self._has_running_job("auto-roller-doctor"):
            raise RuntimeError("Runtime Check is running. Wait for it before repairing the runtime.")
        settings = self.settings_store.read()
        settings.auto_roller_profile = request.profile
        settings.last_install_profile = request.profile
        settings.last_install_at = utc_now_iso()
        settings.last_install_status = "running"
        self.settings_store.write(settings)
        runtime = self.manager.inspect(request.profile)
        runtime.runtime_root.mkdir(parents=True, exist_ok=True)

        def finalize_install(job_model: JobModel, *, succeeded: bool) -> dict:
            current = self.settings_store.read()
            current.auto_roller_profile = request.profile
            current.last_install_profile = request.profile
            current.last_install_at = utc_now_iso()
            info = self.manager.inspect(request.profile)
            install_ok = bool(info.install_report.get("ok")) if info.install_report is not None else succeeded
            doctor_ok = request.skip_doctor or (bool(info.doctor_report.get("ok")) if info.doctor_report is not None else succeeded)
            current.last_install_status = "passed" if install_ok else "failed"
            if not request.skip_doctor:
                current.last_doctor_status = "passed" if doctor_ok else "failed"
                current.last_doctor_at = current.last_install_at
            self.settings_store.write(current)
            if not install_ok and not info.install_report:
                self.manager.update_metadata(
                    request.profile,
                    {
                        "last_install_status": "failed",
                        "last_install_error": job_model.error or f"Command exited with code {job_model.return_code}",
                    },
                )
            return {
                "profile": request.profile,
                "installed_at": current.last_install_at,
                "runtime_id": info.runtime_id,
                "runtime_python": str(info.python_path),
                "runtime_status": info.status,
                "install_report": info.install_report,
                "doctor_report": info.doctor_report,
            }

        def on_success(job_model: JobModel) -> dict:
            return finalize_install(job_model, succeeded=True)

        def on_failure(job_model: JobModel) -> dict:
            return finalize_install(job_model, succeeded=False)

        return self.jobs.create_subprocess_job(
            kind="auto-roller-runtime-install",
            project_id=None,
            command=self.manager.install_command(request.profile, skip_doctor=request.skip_doctor),
            cwd=runtime.runtime_root,
            on_success=on_success,
            on_failure=on_failure,
        )
