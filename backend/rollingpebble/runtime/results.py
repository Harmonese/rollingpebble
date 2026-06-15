from __future__ import annotations

import subprocess
from typing import Any

from rollingpebble.models import JobModel
from rollingpebble.runtime.manager import RuntimeManager
from rollingpebble.runtime.reports import (
    final_report_or_plain_json,
    json_from_log_lines,
    protocol_status_ok,
    report_artifact_paths,
    report_error_message,
)
from rollingpebble.runtime.settings import RuntimeSettingsService
from rollingpebble.storage.app_settings import utc_now_iso


class RuntimeResultStore:
    def __init__(self, *, manager: RuntimeManager, settings: RuntimeSettingsService) -> None:
        self.manager = manager
        self.settings = settings

    def capture_doctor_report(self, profile: str) -> dict[str, Any] | None:
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
            return json_from_log_lines(result.stdout.splitlines())
        except Exception:
            return None

    def store_doctor_result(
        self,
        profile: str,
        doctor_report: dict[str, Any] | None,
        *,
        succeeded: bool,
    ) -> dict[str, Any]:
        current = self.settings.read()
        ok = protocol_status_ok(doctor_report, fallback=succeeded)
        current.last_doctor_status = "passed" if ok else "failed"
        current.last_doctor_at = utc_now_iso()
        self.settings.write(current)
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

    def store_upgrade_result(self, profile: str, request_profile: str, job_model: JobModel, *, succeeded: bool) -> dict:
        new_version: str | None = None
        if succeeded:
            info = self.manager.inspect(profile)
            new_version = self.manager.pyroller_version_from_python(info.python_path)
            if new_version:
                self.manager.update_metadata(
                    profile,
                    {
                        "pyroller_version": new_version,
                        "pyroller_source": self.manager.dependency_source_label(),
                        "last_upgrade_status": "passed",
                        "last_upgrade_at": utc_now_iso(),
                    },
                )
        return {
            "profile": request_profile,
            "succeeded": succeeded,
            "new_version": new_version,
            "message": f"py-roller upgraded to {new_version}." if succeeded and new_version
            else "py-roller upgraded successfully." if succeeded
            else f"Upgrade failed: {job_model.error or 'unknown error'}",
        }

    def mark_install_started(self, profile: str) -> None:
        settings = self.settings.read()
        settings.auto_roller_profile = profile
        settings.last_install_profile = profile
        settings.last_install_at = utc_now_iso()
        settings.last_install_status = "running"
        self.settings.write(settings)

    def store_install_result(self, profile: str, job_model: JobModel, *, skip_doctor: bool, succeeded: bool) -> dict:
        current = self.settings.read()
        current.auto_roller_profile = profile
        current.last_install_profile = profile
        current.last_install_at = utc_now_iso()
        info = self.manager.inspect(profile)
        install_ok = protocol_status_ok(info.install_report, fallback=succeeded)
        doctor_ok = skip_doctor or protocol_status_ok(info.doctor_report, fallback=succeeded)
        current.last_install_status = "passed" if install_ok else "failed"
        if not skip_doctor:
            current.last_doctor_status = "passed" if doctor_ok else "failed"
            current.last_doctor_at = current.last_install_at
        self.settings.write(current)
        if not install_ok and not info.install_report:
            self.manager.update_metadata(
                profile,
                {
                    "last_install_status": "failed",
                    "last_install_error": job_model.error or f"Command exited with code {job_model.return_code}",
                },
            )
        return {
            "profile": profile,
            "installed_at": current.last_install_at,
            "runtime_id": info.runtime_id,
            "runtime_python": str(info.python_path),
            "runtime_status": info.status,
            "install_report": info.install_report,
            "doctor_report": info.doctor_report,
        }

    @staticmethod
    def cache_model_result(job_model: JobModel, *, succeeded: bool) -> dict:
        report = final_report_or_plain_json(job_model, report_type="cache_model_result")
        artifact_paths = report_artifact_paths(report)
        error = report_error_message(report) or job_model.error
        return {
            "succeeded": succeeded,
            "report": report,
            "artifact_paths": artifact_paths,
            "model_dir": artifact_paths.get("model_dir"),
            "backend": report.get("backend") if report else None,
            "language": report.get("language") if report else None,
            "effective_model_name": report.get("effective_model_name") if report else None,
            "resolved_model_dir": str(report.get("resolved_model_dir")) if report and report.get("resolved_model_dir") is not None else None,
            "model_store_root": str(report.get("model_store_root")) if report and report.get("model_store_root") is not None else None,
            "message": "Model cached successfully." if succeeded
            else f"Model cache failed: {error or 'unknown error'}",
        }
