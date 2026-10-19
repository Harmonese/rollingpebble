from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from pathlib import Path

from rollingpebble.jobs_runner import request_process_stop, run_subprocess_job, utc_now_iso
from rollingpebble.jobs_store import JobStore, ManagedJob
from rollingpebble.messages import msg, message_from_exception
from rollingpebble.models import JobModel, JobStatus

PreparedSubprocessJob = tuple[list[str], Path | None, dict[str, str] | None, Callable[[], None] | None]
SubprocessJobPreparer = Callable[[str, Path], PreparedSubprocessJob]


class JobManager:
    def __init__(self, *, work_root: Path | None = None) -> None:
        self._store = JobStore()
        self.resource_lock = threading.Lock()
        self.work_root = work_root

    def create_worker_job(self, *, kind, worker):
        """Host workers share job polling and hold the resource lock through cancellation."""
        if not self.resource_lock.acquire(blocking=False):
            raise RuntimeError("Auto Timing resources are busy")
        managed = ManagedJob(model=JobModel(job_id=f"job_{uuid.uuid4().hex[:12]}", kind=kind,
                             status=JobStatus.queued, started_at=utc_now_iso(), updated_at=utc_now_iso()),
                             cancel_event=threading.Event())
        def progress(value):
            with managed.lock:
                managed.model.progress = value
                managed.model.updated_at = utc_now_iso()
        def run():
            try:
                with managed.lock:
                    if not managed.cancel_event.is_set():
                        managed.model.status = JobStatus.running
                result = worker(managed.cancel_event, progress)
                with managed.lock:
                    managed.model.result = result
            except Exception as exc:
                with managed.lock:
                    managed.model.error_message = message_from_exception(exc)
                    managed.model.error = managed.model.error_message.fallback
            finally:
                with managed.lock:
                    managed.model.status = (JobStatus.canceled if managed.cancel_event.is_set() else
                                            JobStatus.failed if managed.model.error else JobStatus.succeeded)
                    managed.model.updated_at = utc_now_iso()
                    # Publish terminal status and unlock together, after all file handles close.
                    self.resource_lock.release()
        managed.thread = threading.Thread(target=run, name=managed.model.job_id, daemon=True)
        try:
            self._store.add(managed)
            managed.thread.start()
        except BaseException:
            self.resource_lock.release()
            raise
        return self.get(managed.model.job_id)

    def create_subprocess_job(
        self,
        *,
        kind: str,
        project_id: str | None,
        command: list[str],
        cwd: Path | None,
        on_success: Callable[..., dict] | None = None,
        on_failure: Callable[..., dict] | None = None,
        env: dict[str, str] | None = None,
        prepare: SubprocessJobPreparer | None = None,
    ) -> JobModel:
        if not self.resource_lock.acquire(blocking=False):
            raise RuntimeError("Auto Timing resources are busy")
        cleanup_holder = []
        try:
            return self._create_locked_job(kind=kind, project_id=project_id, command=command, cwd=cwd,
                                           on_success=on_success, on_failure=on_failure, env=env,
                                           prepare=prepare, cleanup_holder=cleanup_holder)
        except BaseException:
            try:
                if cleanup_holder:
                    cleanup_holder[0]()
            finally:
                self.resource_lock.release()
            raise

    def _create_locked_job(self, *, kind, project_id, command, cwd, on_success, on_failure, env,
                           prepare, cleanup_holder):
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        now = utc_now_iso()
        job_work_dir = self._job_work_dir(job_id) if prepare is not None else None
        cleanup: Callable[[], None] | None = None
        if prepare is not None:
            assert job_work_dir is not None
            command, cwd, env, cleanup = prepare(job_id, job_work_dir)
        if cleanup:
            cleanup_holder.append(cleanup)
        original_cleanup = cleanup
        def release_resources():
            try:
                if original_cleanup:
                    original_cleanup()
            finally:
                self.resource_lock.release()
        cleanup = release_resources
        managed = ManagedJob(
            model=JobModel(
                job_id=job_id,
                kind=kind,
                project_id=project_id,
                status=JobStatus.queued,
                command=command,
                started_at=now,
                updated_at=now,
            )
        )
        self._store.add(managed)

        thread = threading.Thread(
            target=run_subprocess_job,
            kwargs={
                "managed": managed,
                "command": command,
                "cwd": cwd,
                "on_success": on_success,
                "on_failure": on_failure,
                "env": env,
                "cleanup": cleanup,
            },
            name=job_id,
            daemon=True,
        )
        managed.thread = thread
        try:
            thread.start()
        except BaseException:
            managed.model.status = JobStatus.failed
            raise
        return managed.model.model_copy(deep=True)

    def _job_work_dir(self, job_id: str) -> Path:
        root = self.work_root or Path.cwd() / ".rollingpebble-work"
        path = root / "jobs" / job_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def get(self, job_id: str) -> JobModel:
        managed = self._store.get(job_id)
        if managed is None:
            raise KeyError(job_id)
        with managed.lock:
            return managed.model.model_copy(deep=True)

    def wait(self, job_id: str) -> None:
        managed = self._store.get(job_id)
        if managed and managed.thread:
            managed.thread.join()

    def list(self) -> list[JobModel]:
        output: list[JobModel] = []
        for managed in self._store.list_managed():
            with managed.lock:
                output.append(managed.model.model_copy(deep=True))
        return output

    def cancel(self, job_id: str) -> JobModel:
        managed = self._store.get(job_id)
        if managed is None:
            raise KeyError(job_id)
        with managed.lock:
            if managed.cancel_event is not None:
                if managed.model.status in {JobStatus.queued, JobStatus.running, JobStatus.cancelling}:
                    managed.cancel_event.set()
                    managed.model.status = JobStatus.cancelling
                return managed.model.model_copy(deep=True)
            if managed.model.status not in {JobStatus.queued, JobStatus.running}:
                return managed.model.model_copy(deep=True)
            managed.model.status = JobStatus.canceled
            now = utc_now_iso()
            managed.model.updated_at = now
            managed.model.last_output_at = now
            managed.model.logs.append("Cancellation requested by rollingpebble.")
            if managed.model.progress is not None:
                managed.model.progress.message = "Cancellation requested"
                managed.model.progress.message_message = msg("job.cancel_requested", "Cancellation requested")
            managed.model.error_message = msg("job.cancel_requested", "Cancellation requested")
            process = managed.process
        if process is not None and process.poll() is None:
            request_process_stop(managed, process)
        with managed.lock:
            return managed.model.model_copy(deep=True)
