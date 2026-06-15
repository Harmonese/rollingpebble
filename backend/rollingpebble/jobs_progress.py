from __future__ import annotations

import json
from collections.abc import Iterable

from rollingpebble.models import JobModel, JobProgressModel

PYROLLER_EVENT_PREFIX = "PYROLLER_EVENT "


def clean_progress_line(line: str) -> str:
    return line.replace("\r", "").strip()


def normalize_stage_name(stage: str) -> str:
    normalized = (stage or "").strip().replace("-", "_")
    aliases = {
        "transcriber_preflight": "preflight",
        "model_download": "model_download",
        "model-download": "model_download",
    }
    return aliases.get(normalized, normalized)


def mark_stage_done(model: JobModel, stage: str) -> None:
    clean = normalize_stage_name(stage)
    if clean and clean not in model.completed_stages:
        model.completed_stages.append(clean)


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
    clean = clean_progress_line(line)
    if not clean.startswith(PYROLLER_EVENT_PREFIX):
        return None
    try:
        event = json.loads(clean[len(PYROLLER_EVENT_PREFIX) :])
    except json.JSONDecodeError:
        return None
    if not isinstance(event, dict):
        return None
    if event.get("schema_version") != 1:
        return None
    event_type = str(event.get("type") or "")
    stage_value = event.get("stage")
    if not stage_value and event_type.startswith("download_"):
        stage_value = "model_download"
    if not stage_value and event_type.startswith("install_"):
        stage_value = "install"
    stage = normalize_stage_name(str(stage_value or ""))
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
        message=str(event.get("message") or event.get("line") or event.get("step") or ""),
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


def parse_progress_line(
    line: str,
    previous: JobProgressModel | None = None,
) -> JobProgressModel | None:
    return _parse_pyroller_event_line(line)


def iter_process_output(stream) -> Iterable[tuple[str, str]]:
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
