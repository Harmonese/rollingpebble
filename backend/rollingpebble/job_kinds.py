from __future__ import annotations

from rollingpebble.models import JobModel, JobStatus

AUTO_TIMING = "auto-timing"
BATCH_AUTO_TIMING = "batch-auto-timing"
RUNTIME_INSTALL = "auto-roller-runtime-install"
RUNTIME_DOCTOR = "auto-roller-doctor"
RUNTIME_UPGRADE = "auto-roller-runtime-upgrade"
RUNTIME_CACHE_MODEL = "auto-roller-runtime-cache-model"

RUNNING_STATUSES = {JobStatus.queued, JobStatus.running, "queued", "running"}


def is_running(job: JobModel) -> bool:
    return job.status in RUNNING_STATUSES


def has_running_job(jobs: object, *kinds: str) -> bool:
    if not hasattr(jobs, "list"):
        return False
    return any(job.kind in kinds and is_running(job) for job in jobs.list())
