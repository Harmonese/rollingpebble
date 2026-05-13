from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from lrc_roller.runtime_constants import PYROLLER_EVENT_PREFIX, PYROLLER_RUNTIME_SPEC


class JsonCommandError(RuntimeError):
    def __init__(self, command: list[str], return_code: int, report: dict[str, Any] | None = None) -> None:
        super().__init__(f"Command exited with code {return_code}: {' '.join(command)}")
        self.command = command
        self.return_code = return_code
        self.report = report


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _runtime_id(profile: str) -> str:
    version = f"py{sys.version_info.major}{sys.version_info.minor}"
    return f"pyroller-{version}-{profile}"


def _venv_python(venv: Path) -> Path:
    if platform.system().lower() == "windows":
        return venv / "Scripts" / "python.exe"
    return venv / "bin" / "python"


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


def _runtime_env(venv: Path) -> dict[str, str]:
    env = os.environ.copy()
    bin_dir = venv / ("Scripts" if platform.system().lower() == "windows" else "bin")
    env.update(
        {
            "PYTHONUNBUFFERED": "1",
            "PYTHONNOUSERSITE": "1",
            "PIP_DISABLE_PIP_VERSION_CHECK": "1",
            "PIP_PROGRESS_BAR": "off",
            "VIRTUAL_ENV": str(venv),
            "PATH": f"{bin_dir}{os.pathsep}{env.get('PATH', '')}",
        }
    )
    return env


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
    runtime_id = _runtime_id(profile)
    runtime_root = data_dir / "envs" / runtime_id
    venv = runtime_root / ".venv"
    runtime_json = runtime_root / "runtime.json"
    runtime_root.mkdir(parents=True, exist_ok=True)

    started_at = _now()
    base_payload: dict[str, Any] = {
        "runtime_id": runtime_id,
        "profile": profile,
        "python_version": f"{sys.version_info.major}.{sys.version_info.minor}",
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

    install_report: dict[str, Any] | None = None
    doctor_report: dict[str, Any] | None = None
    source_label = ""
    python = _venv_python(venv)
    env: dict[str, str] | None = None
    try:
        if not python.exists():
            _run([sys.executable, "-m", "venv", str(venv)])
        else:
            print(f"Reusing existing virtual environment: {venv}", flush=True)

        env = _runtime_env(venv)
        _run([str(python), "-m", "pip", "install", "-U", "pip", "setuptools", "wheel"], env=env)

        source = os.environ.get("LRC_ROLLER_PYROLLER_SOURCE", "").strip()
        if source:
            source_path = Path(source).expanduser().resolve()
            print(f"Installing py-roller from local editable source: {source_path}", flush=True)
            _run([str(python), "-m", "pip", "install", "-e", str(source_path)], env=env)
            source_label = f"editable:{source_path}"
        else:
            print(f"Installing/upgrading py-roller runtime package: {PYROLLER_RUNTIME_SPEC}", flush=True)
            _run([str(python), "-m", "pip", "install", "--upgrade", PYROLLER_RUNTIME_SPEC], env=env)
            source_label = PYROLLER_RUNTIME_SPEC

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
                "last_install_status": "ok" if not install_report or install_report.get("ok") else "failed",
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
                "last_install_status": "ok" if not install_report or install_report.get("ok") else "failed",
                "last_doctor_status": "skipped" if skip_doctor else ("ok" if not doctor_report or doctor_report.get("ok") else "failed"),
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
                "last_install_status": "failed" if install_report is None or install_report.get("ok") is False else "ok",
                "last_doctor_status": "skipped" if skip_doctor else ("failed" if doctor_report is None or doctor_report.get("ok") is False else "ok"),
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
    parser = argparse.ArgumentParser(description="Create or repair the isolated lrc-roller py-roller runtime.")
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--profile", choices=("auto", "cpu", "cu124"), default="auto")
    parser.add_argument("--skip-doctor", action="store_true")
    args = parser.parse_args(argv)
    install_runtime(Path(args.data_dir).expanduser().resolve(), args.profile, skip_doctor=args.skip_doctor)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
