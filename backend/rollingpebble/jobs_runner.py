from __future__ import annotations

import inspect
import os
import signal
import subprocess
import threading
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from rollingpebble import job_kinds
from rollingpebble.jobs_progress import (
    PYROLLER_EVENT_PREFIX,
    clean_progress_line,
    iter_process_output,
    mark_stage_done,
    normalize_stage_name,
    parse_progress_line,
)
from rollingpebble.jobs_store import ManagedJob
from rollingpebble.messages import message_from_text
from rollingpebble.models import JobModel, JobProgressModel, JobStatus

CANCEL_GRACE_SECONDS = 8


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _run_callback(callback: Callable[..., dict] | None, snapshot: JobModel) -> dict[str, Any]:
    if callback is None:
        return {}
    try:
        params = inspect.signature(callback).parameters
        return callback(snapshot) if params else callback()
    except (TypeError, ValueError):
        return callback()


def _protocol_error_from_event(event: dict[str, Any]) -> str | None:
    error = event.get("error")
    if isinstance(error, dict):
        message = error.get("message") or error.get("detail") or error.get("code")
        return str(message) if message else None
    if isinstance(error, str) and error.strip():
        return error.strip()
    if event.get("type", "").endswith("failed"):
        message = event.get("message")
        return str(message) if message else None
    return None


def _structured_error(model: JobModel, fallback: str) -> str:
    if model.progress is not None and model.progress.detail:
        message = _protocol_error_from_event(model.progress.detail)
        if message:
            return message
    for event in reversed(model.events):
        message = _protocol_error_from_event(event)
        if message:
            return message
    return fallback


def request_process_stop(managed: ManagedJob, process: subprocess.Popen[str]) -> None:
    def stopper() -> None:
        try:
            if process.poll() is not None:
                return
            if os.name != "nt":
                os.killpg(process.pid, signal.SIGTERM)
            else:
                process.terminate()
            try:
                process.wait(timeout=CANCEL_GRACE_SECONDS)
                return
            except subprocess.TimeoutExpired:
                pass
            with managed.lock:
                managed.model.logs.append("Process did not exit after cancellation; forcing termination.")
                managed.model.updated_at = utc_now_iso()
            if os.name != "nt":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
        except ProcessLookupError:
            return
        except Exception as exc:
            with managed.lock:
                managed.model.logs.append(f"Failed to terminate canceled process: {exc}")
                managed.model.updated_at = utc_now_iso()

    threading.Thread(target=stopper, name=f"cancel-{managed.model.job_id}", daemon=True).start()


def run_subprocess_job(
    managed: ManagedJob,
    *,
    command: list[str],
    cwd: Path | None,
    on_success: Callable[..., dict] | None = None,
    on_failure: Callable[..., dict] | None = None,
    env: dict[str, str] | None = None,
    cleanup: Callable[[], None] | None = None,
) -> None:
    with managed.lock:
        if managed.model.status == JobStatus.canceled:
            return
        managed.model.status = JobStatus.running
        managed.model.updated_at = utc_now_iso()
    try:
        process = subprocess.Popen(
            command,
            cwd=str(cwd) if cwd else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            start_new_session=(os.name != "nt"),
            env=env,
        )
        managed.process = process
        with managed.lock:
            managed.model.command = command
            managed.model.pid = process.pid
            managed.model.updated_at = utc_now_iso()
        assert process.stdout is not None
        last_download_percent: int | None = None
        for output_line, separator in iter_process_output(process.stdout):
            clean_line = clean_progress_line(output_line)
            progress = parse_progress_line(clean_line, managed.model.progress)
            is_structured_event = clean_line.startswith(PYROLLER_EVENT_PREFIX)
            event_detail = progress.detail if progress is not None and is_structured_event else None
            should_append_log = separator == "\n" and not is_structured_event
            if event_detail and event_detail.get("type") == "install_subprocess_output" and event_detail.get("line"):
                should_append_log = True
                clean_line = str(event_detail.get("line"))
            if separator == "\r" and progress is not None and normalize_stage_name(progress.stage) == "model_download":
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
                now = utc_now_iso()
                managed.model.updated_at = now
                managed.model.last_output_at = now
                if should_append_log:
                    managed.model.logs.append(clean_line)
                if event_detail and event_detail.get("type") != "install_subprocess_output":
                    managed.model.events.append(event_detail)
                    if len(managed.model.events) > 500:
                        managed.model.events = managed.model.events[-500:]
                if progress is not None:
                    managed.model.progress = progress
                    if progress.done:
                        mark_stage_done(managed.model, progress.stage)
                if len(managed.model.logs) > 1200:
                    managed.model.logs = managed.model.logs[-1200:]
        return_code = process.wait()
        with managed.lock:
            if managed.model.status == JobStatus.canceled:
                return
        if return_code != 0:
            with managed.lock:
                failure_model = managed.model.model_copy(deep=True)
            result = _run_callback(on_failure, failure_model)
            fallback = f"Command exited with code {return_code}"
            error = _structured_error(failure_model, fallback)
            with managed.lock:
                managed.model.status = JobStatus.failed
                managed.model.return_code = return_code
                managed.model.updated_at = utc_now_iso()
                managed.model.error = error
                managed.model.error_message = message_from_text(managed.model.error)
                managed.model.result = result or None
                if managed.model.progress is not None:
                    managed.model.progress.failed = True
            return
        result: dict[str, Any] = {}
        if on_success is not None:
            with managed.lock:
                success_model = managed.model.model_copy(deep=True)
            result = _run_callback(on_success, success_model)
        with managed.lock:
            managed.model.status = JobStatus.succeeded
            managed.model.return_code = return_code
            managed.model.updated_at = utc_now_iso()
            managed.model.result = result
            complete_message = "Task complete"
            if managed.model.kind == job_kinds.RUNTIME_INSTALL:
                runtime_id = result.get("runtime_id") if isinstance(result, dict) else None
                complete_message = f"Runtime ready: {runtime_id}" if runtime_id else "Runtime ready"
            elif managed.model.kind == job_kinds.RUNTIME_DOCTOR:
                complete_message = ""
            elif managed.model.kind == job_kinds.AUTO_TIMING:
                complete_message = "Automatic timing complete"
            managed.model.progress = JobProgressModel(
                stage="complete",
                completed=1,
                total=1,
                unit="task",
                message=complete_message,
                message_message=message_from_text(complete_message) if complete_message else None,
                percent=1.0,
                progress=1.0,
                raw="",
                done=True,
            )
    except Exception as exc:  # pragma: no cover - subprocess/env dependent
        result: dict[str, Any] = {}
        with managed.lock:
            failure_model = managed.model.model_copy(deep=True)
        try:
            result = _run_callback(on_failure, failure_model)
        except Exception:
            result = {}
        with managed.lock:
            if managed.model.status != JobStatus.canceled:
                now = utc_now_iso()
                managed.model.status = JobStatus.failed
                managed.model.updated_at = now
                managed.model.last_output_at = managed.model.last_output_at or now
                managed.model.error = str(exc)
                managed.model.error_message = message_from_text(str(exc))
                managed.model.result = result or None
                managed.model.logs.append(f"Failed to start or monitor command: {exc}")
    finally:
        if cleanup is not None:
            cleanup()
