import sys
import time
import shutil
from pathlib import Path

from rollingpebble.jobs import JobManager
from rollingpebble.models import JobStatus


def _wait_for_finished(jobs: JobManager, job_id: str):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        job = jobs.get(job_id)
        if job.status not in {JobStatus.queued, JobStatus.running}:
            return job
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def _wait_for_missing(path: Path) -> None:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if not path.exists():
            return
        time.sleep(0.02)
    raise AssertionError(f"{path} still exists")


def test_prepared_subprocess_job_cleans_private_work_dir(tmp_path: Path) -> None:
    manager = JobManager(work_root=tmp_path / "work")
    captured: dict[str, Path] = {}

    def prepare(job_id: str, work_dir: Path):
        captured["work_dir"] = work_dir
        request = work_dir / "request.json"
        request.write_text("{}", encoding="utf-8")
        command = [sys.executable, "-c", "print('ok')"]
        return command, tmp_path, {}, lambda: shutil.rmtree(work_dir, ignore_errors=True)

    job = manager.create_subprocess_job(
        kind="test",
        project_id=None,
        command=[],
        cwd=tmp_path,
        prepare=prepare,
    )
    finished = _wait_for_finished(manager, job.job_id)

    assert finished.status == JobStatus.succeeded
    assert finished.command[:2] == [sys.executable, "-c"]
    assert captured["work_dir"] == tmp_path / "work" / "jobs" / job.job_id
    _wait_for_missing(captured["work_dir"])


def test_protocol_error_event_becomes_job_error(tmp_path: Path) -> None:
    manager = JobManager(work_root=tmp_path / "work")
    script = (
        "print('PYROLLER_EVENT {\"schema_version\": 1, \"type\": \"stage_failed\", "
        "\"stage\": \"writer\", \"message\": \"writer failed\", "
        "\"error\": {\"message\": \"structured failure\"}}')\n"
        "raise SystemExit(7)"
    )

    job = manager.create_subprocess_job(
        kind="test",
        project_id=None,
        command=[sys.executable, "-c", script],
        cwd=tmp_path,
    )
    finished = _wait_for_finished(manager, job.job_id)

    assert finished.status == JobStatus.failed
    assert finished.return_code == 7
    assert finished.error == "structured failure"
