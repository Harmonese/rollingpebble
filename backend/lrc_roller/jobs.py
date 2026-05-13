from __future__ import annotations

import json
import re
import subprocess
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

from lrc_roller.models import JobModel, JobProgressModel, JobStatus

_PYROLLER_EVENT_PREFIX = "PYROLLER_EVENT "


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


def _normalize_stage_name(stage: str) -> str:
    normalized = (stage or "").strip().replace("-", "_")
    aliases = {
        "transcriber_preflight": "preflight",
        "model_download": "model_download",
        "model-download": "model_download",
    }
    return aliases.get(normalized, normalized)


def _mark_stage_done(model: JobModel, stage: str) -> None:
    clean = _normalize_stage_name(stage)
    if clean and clean not in model.completed_stages:
        model.completed_stages.append(clean)


def _is_model_download_tqdm(clean: str, previous: JobProgressModel | None) -> bool:
    lowered = clean.lower()
    if previous is not None and _normalize_stage_name(previous.stage) == "model_download":
        return True
    return any(token in lowered for token in ("fetching", "model", "download", "hugging", "hf", "xet", "cache"))


def _is_demucs_tqdm(clean: str, previous: JobProgressModel | None) -> bool:
    lowered = clean.lower()
    if previous is not None and _normalize_stage_name(previous.stage) == "splitter":
        return True
    return "seconds/s" in lowered or "track" in lowered or "separating" in lowered


def _event_percent(value: object) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    if value > 1.0:
        value = value / 100.0
    return max(0.0, min(1.0, float(value)))


def _int_or_zero(value: object) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return max(0, int(value))
    return 0


def _optional_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return max(0, int(value))
    return None


def _optional_float(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _parse_pyroller_event_line(line: str) -> JobProgressModel | None:
    clean = _clean_progress_line(line)
    if not clean.startswith(_PYROLLER_EVENT_PREFIX):
        return None
    try:
        event = json.loads(clean[len(_PYROLLER_EVENT_PREFIX) :])
    except json.JSONDecodeError:
        return None
    if not isinstance(event, dict):
        return None
    event_type = str(event.get("type") or "")
    stage = _normalize_stage_name(str(event.get("stage") or ("model_download" if event_type.startswith("download_") else "")))
    completed = _int_or_zero(event.get("completed"))
    total = _int_or_zero(event.get("total"))
    percent = _event_percent(event.get("progress"))
    if percent is None:
        percent = _event_percent(event.get("percent"))
    bytes_downloaded = _optional_int(event.get("bytes_downloaded"))
    bytes_total = _optional_int(event.get("bytes_total"))
    if percent is None and bytes_downloaded is not None and bytes_total:
        percent = max(0.0, min(1.0, bytes_downloaded / bytes_total))
    if event_type == "download_completed":
        percent = 1.0 if bytes_total else percent
    if percent is not None and total == 0:
        completed = int(round(percent * 100))
        total = 100
    return JobProgressModel(
        stage=stage,
        event_type=event_type,
        completed=completed,
        total=total,
        unit=str(event.get("unit") or ("%" if total == 100 else "")),
        message=str(event.get("message") or ""),
        percent=percent,
        progress=percent,
        raw=clean,
        done=bool(event.get("done")) or event_type.endswith("completed"),
        failed=bool(event.get("failed")) or event_type.endswith("failed"),
        bytes_downloaded=bytes_downloaded,
        bytes_total=bytes_total,
        bytes_per_second=_optional_float(event.get("bytes_per_second")),
        repo_id=str(event.get("repo_id")) if event.get("repo_id") is not None else None,
        cache_dir=str(event.get("cache_dir")) if event.get("cache_dir") is not None else None,
        detail=event,
    )


def _parse_download_progress_line(line: str, previous: JobProgressModel | None = None) -> JobProgressModel | None:
    """Extract model/download progress emitted by Hugging Face/tqdm.

    Be conservative: Demucs also prints tqdm-style percentage bars, so a bare
    ``42%|...|`` line must not be treated as model download unless the previous
    structured progress snapshot was already model-download or the line carries
    a model/download hint.
    """
    clean = _clean_progress_line(line)
    if not clean:
        return None

    match = _TQDM_PERCENT_RE.search(clean)
    if match:
        if not _is_model_download_tqdm(clean, previous):
            return None
        percent_value = max(0.0, min(100.0, float(match.group("percent"))))
        label = (match.group("label") or "Model download").strip(" :-") or "Model download"
        completed_text = match.group("completed")
        total_text = match.group("total")
        bracket = (match.group("bracket") or "").strip()
        message_parts = [label]
        if completed_text and total_text:
            message_parts.append(f"{completed_text}/{total_text}")
        if bracket:
            message_parts.append(bracket)
        return JobProgressModel(
            stage="model_download",
            completed=int(round(percent_value)),
            total=100,
            unit="%",
            message=" · ".join(message_parts),
            percent=percent_value / 100.0,
            progress=percent_value / 100.0,
            raw=clean,
        )

    if _DOWNLOAD_HINT_RE.search(clean):
        previous_is_download = previous is not None and _normalize_stage_name(previous.stage) == "model_download"
        return JobProgressModel(
            stage="model_download",
            completed=previous.completed if previous_is_download else 0,
            total=previous.total if previous_is_download else 0,
            unit=previous.unit if previous_is_download else "",
            message=clean.split("|", maxsplit=3)[-1].strip() if "|" in clean else clean,
            percent=previous.percent if previous_is_download else None,
            progress=previous.progress if previous_is_download else None,
            raw=clean,
        )

    return None


def _parse_demucs_progress_line(line: str, previous: JobProgressModel | None = None) -> JobProgressModel | None:
    """Extract Demucs native tqdm progress as splitter progress.

    Demucs writes progress bars such as ``50%|...| 175.5/351.0 [..seconds/s]``.
    Earlier lrc-roller versions parsed every tqdm line as model download, which
    made Vocal separation jump back to the model-download card.
    """
    clean = _clean_progress_line(line)
    if not clean:
        return None
    match = _TQDM_PERCENT_RE.search(clean)
    if not match or not _is_demucs_tqdm(clean, previous):
        return None
    percent_value = max(0.0, min(100.0, float(match.group("percent"))))
    completed_text = match.group("completed")
    total_text = match.group("total")
    bracket = (match.group("bracket") or "").strip()
    message_parts = ["Separating vocals"]
    if completed_text and total_text:
        message_parts.append(f"{completed_text}/{total_text} sec")
    if bracket:
        message_parts.append(bracket)
    return JobProgressModel(
        stage="splitter",
        completed=int(round(percent_value)),
        total=100,
        unit="%",
        message=" · ".join(message_parts),
        percent=percent_value / 100.0,
        progress=percent_value / 100.0,
        raw=clean,
    )


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

    stage = _normalize_stage_name((match.group("stage") or "").strip())
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
            stage="model_download",
            completed=0,
            total=0,
            unit="",
            message="Checking/downloading model cache",
            percent=None,
            progress=None,
            raw=line,
        )

    return JobProgressModel(
        stage=stage,
        completed=completed,
        total=total,
        unit=unit,
        message=message,
        percent=percent,
        progress=percent,
        raw=line,
        done=done,
        failed=failed,
    )


def _parse_progress_line(line: str, previous: JobProgressModel | None = None) -> JobProgressModel | None:
    return (
        _parse_pyroller_event_line(line)
        or _parse_pyroller_progress_line(line, previous)
        or _parse_demucs_progress_line(line, previous)
        or _parse_download_progress_line(line, previous)
    )


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
                    is_structured_event = clean_line.startswith(_PYROLLER_EVENT_PREFIX)
                    should_append_log = separator == "\n" and not is_structured_event
                    if separator == "\r" and progress is not None and _normalize_stage_name(progress.stage) == "model_download":
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
                            if progress.done:
                                _mark_stage_done(managed.model, progress.stage)
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
