from __future__ import annotations

import io
import json
import sys

import pytest

from rollingpebble.runtime.installer import JsonCommandError, _run_json
from rollingpebble.jobs_progress import iter_process_output, parse_progress_line
from rollingpebble.runtime.reports import json_from_log_lines


@pytest.mark.parametrize("return_code", [0, 1])
def test_installer_preserves_nested_final_report(return_code: int) -> None:
    report = {
        "schema_version": 1,
        "protocol_version": 1,
        "engine": "py-roller",
        "type": "doctor_result",
        "status": "ok" if return_code == 0 else "failed",
        "checks": [{"name": "python", "details": {"version": "3.12.15"}}],
        "error": None if return_code == 0 else {"message": "dependency missing"},
    }
    script = (
        "import json, sys\n"
        "print('checking dependencies')\n"
        "print(json.dumps({'previous': True}, indent=2))\n"
        "print('PYROLLER_EVENT ' + json.dumps({'type': 'heartbeat'}))\n"
        f"print(json.dumps({report!r}, indent=2))\n"
        "print('check finished')\n"
        f"sys.exit({return_code})\n"
    )
    command = [sys.executable, "-c", script]
    if return_code == 0:
        assert _run_json(command) == report
    else:
        with pytest.raises(JsonCommandError) as caught:
            _run_json(command)
        assert caught.value.return_code == return_code
        assert caught.value.report == report


@pytest.mark.parametrize("ending", ["\n", "\r\n", ""])
def test_long_protocol_report_is_not_split(ending: str) -> None:
    report = {"type": "run_result", "quality": {"details": "timing detail " * 2000}}
    line = json.dumps(report)
    records = list(iter_process_output(io.StringIO(line + ending)))
    assert len(records) == 1
    assert json_from_log_lines([records[0][0]]) == report


def test_long_progress_event_is_not_split() -> None:
    event = {"schema_version": 1, "type": "stage_progress", "message": "x" * 20000}
    records = list(iter_process_output(io.StringIO("PYROLLER_EVENT " + json.dumps(event) + "\n")))
    assert len(records) == 1
    assert parse_progress_line(records[0][0]).detail == event


def test_carriage_return_progress_remains_separate() -> None:
    assert list(iter_process_output(io.StringIO("10%\r20%\r\nfinished\n"))) == [
        ("10%", "\r"), ("20%", "\r"), ("finished", "\n"),
    ]
