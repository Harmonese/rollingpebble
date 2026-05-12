from __future__ import annotations

import re
import subprocess
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

from lrc_roller.models import JobModel, JobProgressModel, JobStatus


_ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_PROGRESS_LINE_RE = re.compile(
    r"pyroller\.progress\s*\|\s*"
    r"(?P<stage>[^\[]*?)(?:\s+\[(?P<completed>\d+)/(?:\s*)?(?P<total>\d+)\s+(?P<unit>[^\]]+)\])?"
    r"(?:\s+-\s+(?P<message>.*))?$"
)
_TQDM_PERCENT_RE = re.compile(
    r"(?P<label>.*?)(?:\s*:)?\s*"
    r"(?P<percent>\d{1,3}(?:\.\d+)?)%\|.*?\|\s*"
    r"(?P<completed>[^\s/]+)/(?P<total>[^\s\[]+)"
    r"(?:\s+\[(?P<bracket>[^\]]+)\])?"
)
_DOWNLOAD_HINT_RE = re.compile(
    r"(checking/downloading model cache|Downloading model into local cache|Preparing model download|Model source repo|Fetching\s+\d+\s+files)",
    re.IGNORECASE,
)


def _clean_progress_line(line: str) -> str:
    return _ANSI_RE.sub("", line).replace("\r", "").strip()


def _parse_download_progress_line(line: str, previous: JobProgressModel | None = None) -> JobProgressModel | None:
    """Extract model/download progress emitted by tqdm/Hugging Face.

    py-roller's own progress logger can only say that the model cache is being
    checked. The actual Hugging Face/tqdm download output is written as carriage
    return updates, for example:

        Fetching 6 files:  33%|███▎      | 2/6 [00:12<00:22,  5.62s/it]
        model.bin:  48%|████▊     | 1.02G/2.10G [00:20<00:18, 58.1MB/s]

    These updates are not normal newline-terminated log lines, so JobManager
    reads stdout/stderr on both "\\n" and "\\r" and maps these lines to a
    dedicated Model Download progress snapshot.
    """
    clean = _clean_progress_line(line)
    if not clean:
        return None

    match = _TQDM_PERCENT_RE.search(clean)
    if match:
        percent_value = max(0.0, min(100.0, float(match.group("percent"))))
        label = (match.group("label") or "Model download").strip(" :-") or "Model download"
        completed_text = match.group("completed")
        total_text = match.group("total")
        bracket = (match.group("bracket") or "").strip()
        message_parts = [label]
        if completed_text and total_text:
            message_parts.append(f"{completed_text}/{total_text}")
        if bracket:
            # Keep only compact speed/ETA information; long tqdm postfixes make
            # the small task panel noisy.
            message_parts.append(bracket)
        return JobProgressModel(
            stage="model-download",
            completed=int(round(percent_value)),
            total=100,
            unit="%",
            message=" · ".join(message_parts),
            percent=percent_value / 100.0,
            raw=clean,
        )

    if _DOWNLOAD_HINT_RE.search(clean):
        previous_is_download = previous is not None and previous.stage == "model-download"
        return JobProgressModel(
            stage="model-download",
            completed=previous.completed if previous_is_download else 0,
            total=previous.total if previous_is_download else 0,
            unit=previous.unit if previous_is_download else "",
            message=clean.split("|", maxsplit=3)[-1].strip() if "|" in clean else clean,
            percent=previous.percent if previous_is_download else None,
            raw=clean,
        )

    return None


def _parse_pyroller_progress_line(line: str, previous: JobProgressModel | None = None) -> JobProgressModel | None:
    """Extract py-roller's logging progress format into a UI-friendly snapshot.

    py-roller writes progress through the `pyroller.progress` logger when stdout
    is piped, for example:

        pyroller.progress | transcriber-preflight [2/3 phase] - resolving model
        pyroller.progress | aligner [120/410 step] - dp row 120/406
        pyroller.progress | writer complete - writer complete

    The parser intentionally ignores non-progress log lines so the raw task log
    remains the source of truth while the UI can show a compact progress bar.
    """
    match = _PROGRESS_LINE_RE.search(_clean_progress_line(line))
    if not match:
        return None

    stage = (match.group("stage") or "").strip()
    message = (match.group("message") or "").strip()
    completed_text = match.group("completed")
    total_text = match.group("total")
    unit = (match.group("unit") or "").strip()
    lower_stage = stage.lower()
    done = False
    failed = False

    if lower_stage.endswith(" complete"):
        stage = stage[: -len(" complete")].strip()
        done = True
    elif lower_stage.endswith(" failed"):
        stage = stage[: -len(" failed")].strip()
        failed = True

    completed = int(completed_text) if completed_text else 0
    total = int(total_text) if total_text else 0
    percent: float | None = None
    if total > 0:
        completed = max(0, min(completed, total))
        percent = completed / total
    elif done:
        completed = 1
        total = 1
        percent = 1.0
    elif failed:
        percent = previous.percent if previous is not None else None
    elif previous is not None and previous.stage == stage:
        completed = previous.completed
        total = previous.total
        unit = previous.unit
        percent = previous.percent

    # The py-roller preflight phase only reports that a model cache check has
    # started. Actual Hugging Face/tqdm download updates arrive as separate
    # carriage-return progress lines. Switch the compact UI to a dedicated model
    # download stage here so users do not think the app is stuck at preflight.
    if "checking/downloading model cache" in message.lower():
        return JobProgressModel(
            stage="model-download",
            completed=0,
            total=0,
            unit="",
            message="Checking/downloading model cache",
            percent=None,
            raw=line,
        )

    return JobProgressModel(
        stage=stage,
        completed=completed,
        total=total,
        unit=unit,
        message=message,
        percent=percent,
        raw=line,
        done=done,
        failed=failed,
    )


def _parse_progress_line(line: str, previous: JobProgressModel | None = None) -> JobProgressModel | None:
    return _parse_pyroller_progress_line(line, previous) or _parse_download_progress_line(line, previous)


def _iter_process_output(stream) -> Iterable[tuple[str, str]]:
    """Yield subprocess output records split on newline and carriage return.

    tqdm progress bars update the current terminal line using "\\r" instead of
    "\\n". Reading with `for line in stream` would hide download progress until
    the process exits. A small char reader keeps normal logs intact while also
    surfacing download bars in real time.
    """
    buffer: list[str] = []
    while True:
        char = stream.read(1)
        if char == "":
            break
        if char in {"\n", "\r"}:
            text = "".join(buffer).strip()
            buffer.clear()
            if text:
                yield text, char
            continue
        buffer.append(char)
        if len(buffer) >= 8000:
            text = "".join(buffer).strip()
            buffer.clear()
            if text:
                yield text, "\n"
    text = "".join(buffer).strip()
    if text:
        yield text, "\n"


@dataclass(slots=True)
class ManagedJob:
    model: JobModel
    thread: threading.Thread | None = None
    process: subprocess.Popen[str] | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, ManagedJob] = {}
        self._lock = threading.Lock()

    def create_subprocess_job(
        self,
        *,
        kind: str,
        project_id: str | None,
        command: list[str],
        cwd: Path | None,
        on_success: Callable[[], dict] | None = None,
    ) -> JobModel:
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        managed = ManagedJob(
            model=JobModel(job_id=job_id, kind=kind, project_id=project_id, status=JobStatus.queued, command=command)
        )
        with self._lock:
            self._jobs[job_id] = managed

        def runner() -> None:
            with managed.lock:
                if managed.model.status == JobStatus.canceled:
                    return
                managed.model.status = JobStatus.running
            try:
                process = subprocess.Popen(
                    command,
                    cwd=str(cwd) if cwd else None,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                )
                managed.process = process
                assert process.stdout is not None
                last_download_percent: int | None = None
                for output_line, separator in _iter_process_output(process.stdout):
                    clean_line = _clean_progress_line(output_line)
                    progress = _parse_progress_line(clean_line, managed.model.progress)
                    should_append_log = separator == "\n"
                    if separator == "\r" and progress is not None and progress.stage == "model-download":
                        # tqdm refreshes many times per second. Keep the compact
                        # progress bar live, but only add meaningful download
                        # milestones to the raw task log.
                        if progress.percent is None:
                            should_append_log = False
                        else:
                            percent_int = int(round(progress.percent * 100))
                            should_append_log = (
                                last_download_percent is None
                                or percent_int >= 100
                                or percent_int - last_download_percent >= 5
                            )
                            if should_append_log:
                                last_download_percent = percent_int
                    with managed.lock:
                        if should_append_log:
                            managed.model.logs.append(clean_line)
                        if progress is not None:
                            managed.model.progress = progress
                        if len(managed.model.logs) > 1200:
                            managed.model.logs = managed.model.logs[-1200:]
                return_code = process.wait()
                with managed.lock:
                    if managed.model.status == JobStatus.canceled:
                        return
                if return_code != 0:
                    with managed.lock:
                        managed.model.status = JobStatus.failed
                        managed.model.error = f"Command exited with code {return_code}"
                        if managed.model.progress is not None:
                            managed.model.progress.failed = True
                    return
                result = on_success() if on_success is not None else {}
                with managed.lock:
                    managed.model.status = JobStatus.succeeded
                    managed.model.result = result
                    managed.model.progress = JobProgressModel(
                        stage="complete",
                        completed=1,
                        total=1,
                        unit="task",
                        message="Automatic timing complete",
                        percent=1.0,
                        raw="",
                        done=True,
                    )
            except Exception as exc:  # pragma: no cover - subprocess/env dependent
                with managed.lock:
                    if managed.model.status != JobStatus.canceled:
                        managed.model.status = JobStatus.failed
                        managed.model.error = str(exc)

        thread = threading.Thread(target=runner, name=job_id, daemon=True)
        managed.thread = thread
        thread.start()
        return managed.model.model_copy(deep=True)

    def get(self, job_id: str) -> JobModel:
        with self._lock:
            managed = self._jobs.get(job_id)
        if managed is None:
            raise KeyError(job_id)
        with managed.lock:
            return managed.model.model_copy(deep=True)

    def list(self) -> list[JobModel]:
        with self._lock:
            jobs = list(self._jobs.values())
        output: list[JobModel] = []
        for managed in jobs:
            with managed.lock:
                output.append(managed.model.model_copy(deep=True))
        return output

    def cancel(self, job_id: str) -> JobModel:
        with self._lock:
            managed = self._jobs.get(job_id)
        if managed is None:
            raise KeyError(job_id)
        with managed.lock:
            if managed.model.status not in {JobStatus.queued, JobStatus.running}:
                return managed.model.model_copy(deep=True)
            managed.model.status = JobStatus.canceled
            managed.model.logs.append("Cancellation requested by lrc-roller.")
            if managed.model.progress is not None:
                managed.model.progress.message = "Cancellation requested"
            process = managed.process
        if process is not None and process.poll() is None:
            try:
                process.terminate()
            except Exception:
                pass
        with managed.lock:
            return managed.model.model_copy(deep=True)
