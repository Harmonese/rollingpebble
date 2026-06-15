from __future__ import annotations

import argparse
import json
import platform
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from rollingpebble.runtime.environment import build_runtime_env, runtime_python_path
from rollingpebble.runtime.constants import (
    PYROLLER_EVENT_PREFIX,
)
from rollingpebble.runtime.recipe import DEFAULT_RUNTIME_RECIPE
from rollingpebble.runtime.python import select_runtime_python
from rollingpebble.runtime.reports import protocol_status_ok


class JsonCommandError(RuntimeError):
    def __init__(self, command: list[str], return_code: int, report: dict[str, Any] | None = None) -> None:
        super().__init__(f"Command exited with code {return_code}: {' '.join(command)}")
        self.command = command
        self.return_code = return_code
        self.report = report


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _runtime_id(profile: str, python_tag: str) -> str:
    return f"pyroller-{python_tag}-{profile}"


def _venv_python(venv: Path) -> Path:
    return runtime_python_path(venv)


def _run(command: list[str], *, env: dict[str, str] | None = None) -> None:
    print(f"$ {' '.join(command)}", flush=True)
    subprocess.run(command, check=True, env=env)


def _parse_json_block(lines: list[str]) -> dict[str, Any] | None:
    if not lines:
        return None
    try:
        parsed = json.loads("\n".join(lines))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _run_json(command: list[str], *, env: dict[str, str] | None = None) -> dict[str, Any] | None:
    """Run a command, relay its output, and return its final JSON report if any."""
    print(f"$ {' '.join(command)}", flush=True)
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env,
    )
    assert process.stdout is not None
    json_lines: list[str] = []
    capturing_json = False
    for raw_line in process.stdout:
        line = raw_line.rstrip("\n")
        print(line, flush=True)
        stripped = line.strip()
        if stripped.startswith(PYROLLER_EVENT_PREFIX):
            continue
        if stripped.startswith("{"):
            capturing_json = True
            json_lines = [line]
            continue
        if capturing_json:
            json_lines.append(line)
    return_code = process.wait()
    report = _parse_json_block(json_lines)
    if return_code != 0:
        raise JsonCommandError(command, return_code, report)
    return report


def _pyroller_version(python: Path, env: dict[str, str]) -> str | None:
    try:
        result = subprocess.run(
            [str(python), "-c", "import importlib.metadata; print(importlib.metadata.version('py-roller'))"],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
        return result.stdout.strip() or None
    except Exception:
        return None


def _write_runtime_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def install_runtime(data_dir: Path, profile: str, skip_doctor: bool = False) -> None:
    runtime_python = select_runtime_python()
    runtime_id = _runtime_id(profile, runtime_python.tag)
    runtime_root = data_dir / "envs" / runtime_id
    venv = runtime_root / ".venv"
    runtime_json = runtime_root / "runtime.json"
    runtime_root.mkdir(parents=True, exist_ok=True)

    started_at = _now()
    base_payload: dict[str, Any] = {
        "runtime_id": runtime_id,
        "profile": profile,
        "python_version": f"{runtime_python.major}.{runtime_python.minor}",
        "runtime_python_executable": runtime_python.executable,
        "platform": f"{platform.system().lower()}-{platform.machine().lower()}",
        "venv_path": str(venv),
        "python_path": str(_venv_python(venv)),
        "created_or_repaired_at": started_at,
        "last_install_status": "running",
        "last_doctor_status": "skipped" if skip_doctor else "pending",
    }
    _write_runtime_json(runtime_json, base_payload)

    print(f"Creating / repairing isolated py-roller runtime: {runtime_id}", flush=True)
    print(f"Runtime root: {runtime_root}", flush=True)
    print(f"Profile: {profile}", flush=True)
    print(f"Runtime Python: {runtime_python.executable}", flush=True)

    install_report: dict[str, Any] | None = None
    doctor_report: dict[str, Any] | None = None
    source_label = ""
    python = _venv_python(venv)
    env: dict[str, str] | None = None
    try:
        if not python.exists():
            _run([runtime_python.executable, "-m", "venv", str(venv)])
        else:
            print(f"Reusing existing virtual environment: {venv}", flush=True)

        env = build_runtime_env(venv, data_dir, include_dev=True)
        _run(DEFAULT_RUNTIME_RECIPE.bootstrap_command(python), env=env)

        source = DEFAULT_RUNTIME_RECIPE.source_from_env()
        if source:
            source_path = Path(source).expanduser().resolve()
            print(f"Installing py-roller from local editable source: {source_path}", flush=True)
            source_label = DEFAULT_RUNTIME_RECIPE.source_label(source)
        else:
            source_label = DEFAULT_RUNTIME_RECIPE.pyroller_spec
            print(f"Installing/upgrading py-roller runtime package: {source_label}", flush=True)

        dependency_commands = DEFAULT_RUNTIME_RECIPE.dependency_install_commands(python, source=source)
        for command in dependency_commands:
            _run(command, env=env)

        install_report = _run_json(
            [
                str(python),
                "-m",
                "pyroller.cli.main",
                "install",
                "--profile",
                profile,
                "--skip-doctor",
                "--progress-format",
                "jsonl",
                "--output-format",
                "json",
            ],
            env=env,
        )
        partial_version = _pyroller_version(python, env)
        _write_runtime_json(
            runtime_json,
            {
                **base_payload,
                "python_path": str(python),
                "pyroller_version": partial_version,
                "pyroller_source": source_label,
                "last_install_status": "ok" if protocol_status_ok(install_report, fallback=True) else "failed",
                "last_doctor_status": "skipped" if skip_doctor else "pending",
                "install_report": install_report,
                "doctor_report": None,
            },
        )

        if not skip_doctor:
            doctor_report = _run_json([str(python), "-m", "pyroller.cli.main", "doctor", "--output-format", "json"], env=env)

        version = _pyroller_version(python, env)
        _write_runtime_json(
            runtime_json,
            {
                **base_payload,
                "python_path": str(python),
                "pyroller_version": version,
                "pyroller_source": source_label,
                "created_or_repaired_at": _now(),
                "last_install_status": "ok" if protocol_status_ok(install_report, fallback=True) else "failed",
                "last_doctor_status": "skipped" if skip_doctor else ("ok" if protocol_status_ok(doctor_report, fallback=True) else "failed"),
                "install_report": install_report,
                "doctor_report": doctor_report,
            },
        )
        print(f"Runtime ready: {runtime_id}", flush=True)
    except JsonCommandError as exc:
        if exc.report is not None:
            if any(part == "install" for part in exc.command):
                install_report = exc.report
            if any(part == "doctor" for part in exc.command):
                doctor_report = exc.report
        version = _pyroller_version(python, env) if env is not None and python.exists() else None
        _write_runtime_json(
            runtime_json,
            {
                **base_payload,
                "python_path": str(python),
                "pyroller_version": version,
                "pyroller_source": source_label or None,
                "created_or_repaired_at": _now(),
                "last_install_status": "ok" if protocol_status_ok(install_report) else "failed",
                "last_doctor_status": "skipped" if skip_doctor else ("ok" if protocol_status_ok(doctor_report) else "failed"),
                "last_install_error": str(exc),
                "install_report": install_report,
                "doctor_report": doctor_report,
            },
        )
        raise
    except Exception as exc:
        version = _pyroller_version(python, env) if env is not None and python.exists() else None
        _write_runtime_json(
            runtime_json,
            {
                **base_payload,
                "python_path": str(python),
                "pyroller_version": version,
                "pyroller_source": source_label or None,
                "created_or_repaired_at": _now(),
                "last_install_status": "failed",
                "last_doctor_status": "skipped" if skip_doctor else "failed",
                "last_install_error": f"{exc.__class__.__name__}: {exc}",
                "install_report": install_report,
                "doctor_report": doctor_report,
            },
        )
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create or repair the isolated rollingpebble py-roller runtime.")
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--profile", choices=("auto", "cpu", "cu124"), default="auto")
    parser.add_argument("--skip-doctor", action="store_true")
    args = parser.parse_args(argv)
    install_runtime(Path(args.data_dir).expanduser().resolve(), args.profile, skip_doctor=args.skip_doctor)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
