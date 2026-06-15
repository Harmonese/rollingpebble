from __future__ import annotations

import subprocess
import threading
from dataclasses import dataclass, field

from rollingpebble.models import JobModel, JobStatus

MAX_RETAINED_JOBS = 100


@dataclass(slots=True)
class ManagedJob:
    model: JobModel
    thread: threading.Thread | None = None
    process: subprocess.Popen[str] | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)


class JobStore:
    def __init__(self, *, max_retained: int = MAX_RETAINED_JOBS) -> None:
        self._jobs: dict[str, ManagedJob] = {}
        self._lock = threading.Lock()
        self._max_retained = max_retained

    def add(self, managed: ManagedJob) -> None:
        with self._lock:
            self._jobs[managed.model.job_id] = managed
            self._prune_finished_jobs_locked()

    def get(self, job_id: str) -> ManagedJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list_managed(self) -> list[ManagedJob]:
        with self._lock:
            return list(self._jobs.values())

    def _prune_finished_jobs_locked(self) -> None:
        overflow = len(self._jobs) - self._max_retained
        if overflow <= 0:
            return
        removable: list[tuple[str, str]] = []
        for job_id, managed in self._jobs.items():
            status = managed.model.status
            if status not in {JobStatus.queued, JobStatus.running}:
                removable.append((managed.model.updated_at or managed.model.started_at or "", job_id))
        removable.sort()
        for _, job_id in removable[:overflow]:
            self._jobs.pop(job_id, None)
