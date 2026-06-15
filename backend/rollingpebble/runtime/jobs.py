from __future__ import annotations

from rollingpebble import job_kinds
from rollingpebble.jobs import JobManager
from rollingpebble.models import JobModel, ModelCacheRequest, RuntimeInstallRequest, RuntimeUpgradeRequest
from rollingpebble.runtime.environment import build_base_subprocess_env
from rollingpebble.runtime.manager import RuntimeManager
from rollingpebble.runtime.reports import final_report_or_plain_json
from rollingpebble.runtime.results import RuntimeResultStore
from rollingpebble.runtime.settings import RuntimeSettingsService


class RuntimeJobService:
    def __init__(
        self,
        *,
        jobs: JobManager,
        manager: RuntimeManager,
        settings: RuntimeSettingsService,
        results: RuntimeResultStore,
    ) -> None:
        self.jobs = jobs
        self.manager = manager
        self.settings = settings
        self.results = results

    def _has_running_job(self, kind: str) -> bool:
        return job_kinds.has_running_job(self.jobs, kind)

    def _has_engine_job(self) -> bool:
        return job_kinds.has_running_job(
            self.jobs,
            job_kinds.AUTO_TIMING,
            job_kinds.BATCH_AUTO_TIMING,
        )

    def _has_runtime_job(self) -> bool:
        return job_kinds.has_running_job(
            self.jobs,
            job_kinds.RUNTIME_INSTALL,
            job_kinds.RUNTIME_DOCTOR,
            job_kinds.RUNTIME_UPGRADE,
            job_kinds.RUNTIME_CACHE_MODEL,
        )

    def run_doctor(self) -> JobModel:
        if self._has_engine_job():
            raise RuntimeError("Auto Timing is running. Cancel or wait for it before running Runtime Check.")
        if self._has_runtime_job():
            raise RuntimeError("Another runtime job is already running.")
        settings = self.settings.read()
        runtime = self.manager.active_runtime(settings)
        if not runtime.doctorable:
            raise RuntimeError("Isolated Auto Timing runtime is not ready. Create or repair it before running Runtime Check.")

        def on_success(job_model: JobModel) -> dict:
            doctor_report = final_report_or_plain_json(job_model, report_type="doctor_result") or self.results.capture_doctor_report(settings.auto_roller_profile)
            return self.results.store_doctor_result(settings.auto_roller_profile, doctor_report, succeeded=True)

        def on_failure(job_model: JobModel) -> dict:
            doctor_report = final_report_or_plain_json(job_model, report_type="doctor_result")
            return self.results.store_doctor_result(settings.auto_roller_profile, doctor_report, succeeded=False)

        return self.jobs.create_subprocess_job(
            kind=job_kinds.RUNTIME_DOCTOR,
            project_id=None,
            command=self.manager.doctor_command(settings.auto_roller_profile),
            cwd=runtime.runtime_root,
            on_success=on_success,
            on_failure=on_failure,
            env=self.manager.runtime_env(runtime.venv_path),
        )

    def run_upgrade(self, request: RuntimeUpgradeRequest) -> JobModel:
        if self._has_engine_job():
            raise RuntimeError("Auto Timing is running. Cancel or wait for it before upgrading the runtime.")
        if self._has_runtime_job():
            raise RuntimeError("Another runtime job is already running.")
        settings = self.settings.read()
        runtime = self.manager.active_runtime(settings)
        if not runtime.ready:
            raise RuntimeError("Isolated Auto Timing runtime is not ready. Create or repair it before upgrading.")

        return self.jobs.create_subprocess_job(
            kind=job_kinds.RUNTIME_UPGRADE,
            project_id=None,
            command=self.manager.upgrade_command(settings.auto_roller_profile),
            cwd=runtime.runtime_root,
            on_success=lambda job: self.results.store_upgrade_result(
                settings.auto_roller_profile,
                request.profile,
                job,
                succeeded=True,
            ),
            on_failure=lambda job: self.results.store_upgrade_result(
                settings.auto_roller_profile,
                request.profile,
                job,
                succeeded=False,
            ),
            env=self.manager.runtime_env(runtime.venv_path),
        )

    def run_cache_model(self, request: ModelCacheRequest) -> JobModel:
        if self._has_engine_job():
            raise RuntimeError("Auto Timing is running. Cancel or wait for it before caching a model.")
        if self._has_runtime_job():
            raise RuntimeError("Another runtime job is already running.")
        settings = self.settings.read()
        runtime = self.manager.active_runtime(settings)
        if not runtime.ready:
            raise RuntimeError("Isolated Auto Timing runtime is not ready.")

        return self.jobs.create_subprocess_job(
            kind=job_kinds.RUNTIME_CACHE_MODEL,
            project_id=None,
            command=self.manager.cache_model_command(
                settings.auto_roller_profile,
                language=request.language,
                backend=request.transcriber_backend or settings.auto_timing_transcriber_backend,
                model_name=request.transcriber_model_name or settings.auto_timing_transcriber_model_name,
                model_path=request.transcriber_model_path or None,
                hf_xet=request.transcriber_hf_xet or settings.auto_timing_hf_xet,
                hf_proxy=request.transcriber_hf_proxy or settings.auto_timing_hf_proxy,
                hf_etag_timeout=request.transcriber_hf_etag_timeout or settings.auto_timing_hf_etag_timeout,
                hf_download_timeout=request.transcriber_hf_download_timeout or settings.auto_timing_hf_download_timeout,
                hf_max_workers=request.transcriber_hf_max_workers or settings.auto_timing_hf_max_workers,
            ),
            cwd=runtime.runtime_root,
            on_success=lambda job: self.results.cache_model_result(job, succeeded=True),
            on_failure=lambda job: self.results.cache_model_result(job, succeeded=False),
            env=self.manager.runtime_env(runtime.venv_path),
        )

    def run_install(self, request: RuntimeInstallRequest) -> JobModel:
        if self._has_engine_job():
            raise RuntimeError("Auto Timing is running. Cancel or wait for it before repairing the runtime.")
        if self._has_runtime_job():
            raise RuntimeError("Another runtime job is already running.")
        self.results.mark_install_started(request.profile)
        runtime = self.manager.inspect(request.profile)
        runtime.runtime_root.mkdir(parents=True, exist_ok=True)

        return self.jobs.create_subprocess_job(
            kind=job_kinds.RUNTIME_INSTALL,
            project_id=None,
            command=self.manager.install_command(request.profile, skip_doctor=request.skip_doctor),
            cwd=runtime.runtime_root,
            on_success=lambda job: self.results.store_install_result(
                request.profile,
                job,
                skip_doctor=request.skip_doctor,
                succeeded=True,
            ),
            on_failure=lambda job: self.results.store_install_result(
                request.profile,
                job,
                skip_doctor=request.skip_doctor,
                succeeded=False,
            ),
            env=build_base_subprocess_env(include_dev=True),
        )
