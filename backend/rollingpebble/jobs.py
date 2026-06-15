from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from pathlib import Path

from rollingpebble.jobs_runner import request_process_stop, run_subprocess_job, utc_now_iso
from rollingpebble.jobs_store import JobStore, ManagedJob
from rollingpebble.messages import msg
from rollingpebble.models import JobModel, JobStatus

PreparedSubprocessJob = tuple[list[str], Path | None, dict[str, str] | None, Callable[[], None] | None]
SubprocessJobPreparer = Callable[[str, Path], PreparedSubprocessJob]


class JobManager:
    def __init__(self, *, work_root: Path | None = None) -> None:
        self._store = JobStore()
        self.work_root = work_root

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
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        now = utc_now_iso()
        job_work_dir = self._job_work_dir(job_id) if prepare is not None else None
        cleanup: Callable[[], None] | None = None
        if prepare is not None:
            assert job_work_dir is not None
            command, cwd, env, cleanup = prepare(job_id, job_work_dir)
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
        thread.start()
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
