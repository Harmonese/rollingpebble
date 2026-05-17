from __future__ import annotations

import importlib.metadata
import json
import os
import platform
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from lrc_roller.models import RuntimeSettingsModel


@dataclass(slots=True)
class IsolatedRuntimeInfo:
    runtime_id: str
    profile: str
    status: str
    runtime_root: Path
    venv_path: Path
    python_path: Path
    version: str | None = None
    source: str | None = None
    detail: str | None = None
    last_install_status: str | None = None
    last_doctor_status: str | None = None
    install_report: dict | None = None
    doctor_report: dict | None = None

    @property
    def ready(self) -> bool:
        return self.status in {"ready", "unchecked"} and self.python_path.exists()


class RuntimeManager:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.envs_root = data_dir / "envs"
        self.models_root = data_dir / "models" / "transcriber"

    def runtime_id(self, profile: str) -> str:
        version = f"py{sys.version_info.major}{sys.version_info.minor}"
        return f"pyroller-{version}-{profile}"

    def runtime_root(self, profile: str) -> Path:
        return self.envs_root / self.runtime_id(profile)

    def runtime_json_path(self, profile: str) -> Path:
        return self.runtime_root(profile) / "runtime.json"

    def update_metadata(self, profile: str, updates: dict) -> dict:
        path = self.runtime_json_path(profile)
        payload: dict = {}
        if path.exists():
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                payload = {}
        payload.update(updates)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return payload

    def venv_path(self, profile: str) -> Path:
        return self.runtime_root(profile) / ".venv"

    def python_path(self, profile: str) -> Path:
        venv = self.venv_path(profile)
        if platform.system().lower() == "windows":
            return venv / "Scripts" / "python.exe"
        return venv / "bin" / "python"

    def default_model_store(self) -> Path:
        return self.models_root

    def active_runtime(self, settings: RuntimeSettingsModel) -> IsolatedRuntimeInfo:
        return self.inspect(settings.auto_roller_profile)

    def inspect(self, profile: str) -> IsolatedRuntimeInfo:
        root = self.runtime_root(profile)
        venv = self.venv_path(profile)
        python = self.python_path(profile)
        runtime_id = self.runtime_id(profile)
        payload: dict = {}
        runtime_json = self.runtime_json_path(profile)
        if runtime_json.exists():
            try:
                payload = json.loads(runtime_json.read_text(encoding="utf-8"))
            except Exception:
                payload = {}
        if not python.exists():
            return IsolatedRuntimeInfo(
                runtime_id=runtime_id,
                profile=profile,
                status="missing",
                runtime_root=root,
                venv_path=venv,
                python_path=python,
                version=payload.get("pyroller_version"),
                source=payload.get("pyroller_source"),
                detail="Isolated runtime has not been created yet.",
                last_install_status=payload.get("last_install_status"),
                last_doctor_status=payload.get("last_doctor_status"),
                install_report=payload.get("install_report") if isinstance(payload.get("install_report"), dict) else None,
                doctor_report=payload.get("doctor_report") if isinstance(payload.get("doctor_report"), dict) else None,
            )
        version = payload.get("pyroller_version") or self._version_from_python(python)
        if not version:
            return IsolatedRuntimeInfo(
                runtime_id=runtime_id,
                profile=profile,
                status="broken",
                runtime_root=root,
                venv_path=venv,
                python_path=python,
                version=None,
                source=payload.get("pyroller_source"),
                detail="Runtime Python exists, but py-roller is not installed in it.",
                last_install_status=payload.get("last_install_status"),
                last_doctor_status=payload.get("last_doctor_status"),
                install_report=payload.get("install_report") if isinstance(payload.get("install_report"), dict) else None,
                doctor_report=payload.get("doctor_report") if isinstance(payload.get("doctor_report"), dict) else None,
            )
        doctor_report = payload.get("doctor_report") if isinstance(payload.get("doctor_report"), dict) else None
        last_doctor_status = payload.get("last_doctor_status")
        if doctor_report is not None and doctor_report.get("ok") is False:
            status = "unhealthy"
            detail = "Runtime exists, but the last doctor check reported problems."
        elif doctor_report is not None and doctor_report.get("ok") is True:
            status = "ready"
            detail = None
        elif last_doctor_status in {"ok", "passed"}:
            status = "ready"
            detail = None
        else:
            status = "unchecked"
            detail = "Runtime exists, but no successful doctor check has been recorded yet."
        return IsolatedRuntimeInfo(
            runtime_id=runtime_id,
            profile=profile,
            status=status,
            runtime_root=root,
            venv_path=venv,
            python_path=python,
            version=version,
            source=payload.get("pyroller_source"),
            detail=detail,
            last_install_status=payload.get("last_install_status"),
            last_doctor_status=last_doctor_status,
            install_report=payload.get("install_report") if isinstance(payload.get("install_report"), dict) else None,
            doctor_report=doctor_report,
        )

    def _version_from_python(self, python: Path) -> str | None:
        try:
            result = subprocess.run(
                [str(python), "-c", "import importlib.metadata; print(importlib.metadata.version('py-roller'))"],
                check=True,
                capture_output=True,
                text=True,
                timeout=15,
                env=self.runtime_env(python.parent.parent),
            )
            return result.stdout.strip() or None
        except Exception:
            return None

    def runtime_env(self, venv: Path) -> dict[str, str]:
        env = os.environ.copy()
        bin_dir = venv / ("Scripts" if platform.system().lower() == "windows" else "bin")
        env.update(
            {
                "PYTHONUNBUFFERED": "1",
                "PYTHONNOUSERSITE": "1",
                "PIP_DISABLE_PIP_VERSION_CHECK": "1",
                "PIP_PROGRESS_BAR": "off",
                "PIP_CACHE_DIR": str(self.data_dir / "cache" / "pip"),
                "XDG_CACHE_HOME": str(self.data_dir / "cache" / "xdg"),
                "TORCH_HOME": str(self.data_dir / "models" / "torch"),
                "HF_HOME": str(self.data_dir / "models" / "transcriber" / "providers" / "huggingface"),
                "HUGGINGFACE_HUB_CACHE": str(self.data_dir / "models" / "transcriber" / "providers" / "huggingface" / "hub"),
                "VIRTUAL_ENV": str(venv),
                "PATH": f"{bin_dir}{os.pathsep}{env.get('PATH', '')}",
            }
        )
        return env

    def command_prefix(self, profile: str) -> list[str]:
        info = self.inspect(profile)
        if not info.ready:
            raise RuntimeError(
                "Auto Timing runtime is not ready. Create or repair the isolated runtime in Settings before running py-roller."
            )
        return [str(info.python_path), "-m", "pyroller.cli.main"]

    def doctor_command(self, profile: str) -> list[str]:
        return [*self.command_prefix(profile), "doctor", "--output-format", "json"]

    def install_command(self, profile: str, *, skip_doctor: bool = False) -> list[str]:
        command = [sys.executable, "-m", "lrc_roller.runtime_installer", "--data-dir", str(self.data_dir), "--profile", profile]
        if skip_doctor:
            command.append("--skip-doctor")
        return command

    def upgrade_command(self, profile: str) -> list[str]:
        info = self.inspect(profile)
        if not info.ready:
            raise RuntimeError(
                "Auto Timing runtime is not ready. Create or repair the isolated runtime in Settings before upgrading."
            )
        from lrc_roller.runtime_constants import PYROLLER_RUNTIME_SPEC
        return [
            str(info.python_path), "-m", "pip", "install", "--upgrade",
            PYROLLER_RUNTIME_SPEC,
        ]

    def cache_model_command(
        self, profile: str, *, language: str = "mul", backend: str | None = None,
        model_name: str | None = None, model_path: str | None = None,
    ) -> list[str]:
        info = self.inspect(profile)
        if not info.ready:
            raise RuntimeError(
                "Auto Timing runtime is not ready. Create or repair the isolated runtime in Settings before caching models."
            )
        command = [*self.command_prefix(profile), "cache-model", "--language", language, "--progress-format", "jsonl"]
        if backend:
            command.extend(["--transcriber-backend", backend])
        if model_name:
            command.extend(["--transcriber-model-name", model_name])
        if model_path:
            command.extend(["--transcriber-model-path", str(Path(model_path).expanduser())])
        return command

    def legacy_dependency_status(self) -> tuple[bool, str | None, str | None]:
        try:
            version = importlib.metadata.version("py-roller")
        except importlib.metadata.PackageNotFoundError:
            version = None
        return False, version, "Legacy PATH py-roller is ignored; lrc-roller uses an isolated runtime."
