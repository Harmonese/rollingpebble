from __future__ import annotations

import json
from typing import Any

from rollingpebble.models import JobModel


def json_from_log_lines(lines: list[str]) -> dict[str, Any] | None:
    for index in range(len(lines) - 1, -1, -1):
        line = lines[index]
        start = line.find("{")
        if start < 0:
            continue
        candidate_lines = lines[index:]
        candidate_lines[0] = line[start:]
        text = "\n".join(candidate_lines).strip()
        end = text.rfind("}")
        if end <= 0:
            continue
        try:
            payload = json.loads(text[: end + 1])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    return None


def is_protocol_report(payload: object, *, report_type: str | None = None) -> bool:
    if not isinstance(payload, dict):
        return False
    if payload.get("schema_version") != 1 or payload.get("protocol_version") != 1:
        return False
    if payload.get("engine") != "py-roller":
        return False
    return report_type is None or payload.get("type") == report_type


def protocol_status_ok(report: dict[str, Any] | None, *, fallback: bool = False) -> bool:
    if not report:
        return fallback
    status = report.get("status")
    if isinstance(status, str):
        return status.lower() in {"ok", "success", "succeeded", "passed"}
    if "ok" in report:
        return bool(report.get("ok"))
    return fallback


def report_error_message(report: dict[str, Any] | None) -> str | None:
    if not report:
        return None
    error = report.get("error")
    if isinstance(error, dict):
        message = error.get("message") or error.get("detail") or error.get("code")
        return str(message) if message else None
    if isinstance(error, str) and error.strip():
        return error.strip()
    message = report.get("message")
    if isinstance(message, str) and message.strip() and not protocol_status_ok(report):
        return message.strip()
    return None


def report_artifact_paths(report: dict[str, Any] | None) -> dict[str, Any]:
    if not report:
        return {}
    artifact_paths = report.get("artifact_paths")
    return artifact_paths if isinstance(artifact_paths, dict) else {}


def final_report_from_job(job_model: JobModel, *, report_type: str | None = None) -> dict[str, Any] | None:
    for event in reversed(job_model.events):
        if is_protocol_report(event, report_type=report_type):
            return event
    parsed = json_from_log_lines(job_model.logs)
    if is_protocol_report(parsed, report_type=report_type):
        return parsed
    if report_type is None:
        return parsed
    return None


def final_report_or_plain_json(job_model: JobModel, *, report_type: str | None = None) -> dict[str, Any] | None:
    report = final_report_from_job(job_model, report_type=report_type)
    if report is not None:
        return report
    parsed = json_from_log_lines(job_model.logs)
    if report_type is not None and is_protocol_report(parsed):
        return None
    return parsed
