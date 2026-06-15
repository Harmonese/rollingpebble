from __future__ import annotations

import importlib.metadata
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from rollingpebble.models import RuntimeSettingsModel
from rollingpebble.paths import StorageLayout
from rollingpebble.runtime.environment import build_runtime_env, runtime_python_path
from rollingpebble.runtime.recipe import DEFAULT_RUNTIME_RECIPE
from rollingpebble.runtime.python import select_runtime_python, target_runtime_python_tag
from rollingpebble.runtime.reports import protocol_status_ok


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
        return self.status == "ready" and self.python_path.exists()

    @property
    def doctorable(self) -> bool:
        return self.status in {"ready", "unchecked", "unhealthy"} and self.python_path.exists() and self.version is not None


class RuntimeManager:
    def __init__(self, data_dir: Path | StorageLayout) -> None:
        self.layout = data_dir if isinstance(data_dir, StorageLayout) else StorageLayout.from_data_dir(data_dir)
        self.data_dir = self.layout.app_root
        self.envs_root = self.layout.runtime_root
        self.models_root = self.layout.models_root / "transcriber"

    def update_layout(self, layout: StorageLayout) -> None:
        self.layout = layout
        self.data_dir = layout.app_root
        self.envs_root = layout.runtime_root
        self.models_root = layout.models_root / "transcriber"

    def runtime_id(self, profile: str) -> str:
        try:
            version = select_runtime_python().tag
        except RuntimeError:
            version = target_runtime_python_tag()
        return f"pyroller-{version}-{profile}"

    def runtime_root(self, profile: str) -> Path:
        return self.envs_root / self.runtime_id(profile)

    def runtime_json_path(self, profile: str) -> Path:
        return self.runtime_root(profile) / "runtime.json"

    def _read_runtime_metadata(self, profile: str) -> dict:
        path = self.runtime_json_path(profile)
        if not path.exists():
            return {}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def update_metadata(self, profile: str, updates: dict) -> dict:
        path = self.runtime_json_path(profile)
        payload = self._read_runtime_metadata(profile)
        payload.update(updates)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return payload

    def venv_path(self, profile: str) -> Path:
        return self.runtime_root(profile) / ".venv"

    def python_path(self, profile: str) -> Path:
        return runtime_python_path(self.venv_path(profile))

    def default_model_store(self) -> Path:
        return self.models_root

    def active_runtime(self, settings: RuntimeSettingsModel) -> IsolatedRuntimeInfo:
        return self.inspect(settings.auto_roller_profile)

    def inspect(self, profile: str) -> IsolatedRuntimeInfo:
        root = self.runtime_root(profile)
        venv = self.venv_path(profile)
        python = self.python_path(profile)
        runtime_id = self.runtime_id(profile)
        payload = self._read_runtime_metadata(profile)
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
        if doctor_report is not None and not protocol_status_ok(doctor_report):
            status = "unhealthy"
            detail = "Runtime exists, but the last doctor check reported problems."
        elif doctor_report is not None and protocol_status_ok(doctor_report):
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

    def pyroller_version_from_python(self, python: Path) -> str | None:
        return self._version_from_python(python)

    def runtime_env(self, venv: Path) -> dict[str, str]:
        return build_runtime_env(venv, self.layout)

    def command_prefix(self, profile: str) -> list[str]:
        info = self.inspect(profile)
        if not info.ready:
            raise RuntimeError(
                "Auto Timing runtime is not ready. Create or repair the isolated runtime in Settings before running py-roller."
            )
        return [str(info.python_path), "-m", "pyroller.cli.main"]

    def doctor_command(self, profile: str) -> list[str]:
        info = self.inspect(profile)
        if not info.doctorable:
            raise RuntimeError("Isolated Auto Timing runtime is not ready. Create or repair it before running Runtime Check.")
        return [str(info.python_path), "-m", "pyroller.cli.main", "doctor", "--output-format", "json"]

    def install_command(self, profile: str, *, skip_doctor: bool = False) -> list[str]:
        command = [sys.executable, "-m", "rollingpebble.runtime.installer", "--data-dir", str(self.data_dir), "--profile", profile]
        if skip_doctor:
            command.append("--skip-doctor")
        return command

    def upgrade_command(self, profile: str) -> list[str]:
        info = self.inspect(profile)
        if not info.ready:
            raise RuntimeError(
                "Auto Timing runtime is not ready. Create or repair the isolated runtime in Settings before upgrading."
            )
        return [
            sys.executable,
            "-m",
            "rollingpebble.runtime.dependencies",
            "upgrade",
            "--data-dir",
            str(self.data_dir),
            "--venv",
            str(info.venv_path),
        ]

    def dependency_source_label(self) -> str:
        return DEFAULT_RUNTIME_RECIPE.source_label(
            DEFAULT_RUNTIME_RECIPE.source_from_env()
        )

    def cache_model_command(
        self, profile: str, *, language: str = "mul", backend: str | None = None,
        model_name: str | None = None, model_path: str | None = None,
        hf_xet: str | None = None, hf_proxy: str | None = None,
        hf_etag_timeout: int | None = None, hf_download_timeout: int | None = None,
        hf_max_workers: int | None = None,
    ) -> list[str]:
        info = self.inspect(profile)
        if not info.ready:
            raise RuntimeError(
                "Auto Timing runtime is not ready. Create or repair the isolated runtime in Settings before caching models."
            )
        command = [
            *self.command_prefix(profile),
            "cache-model",
            "--language",
            language,
            "--progress-format",
            "jsonl",
            "--output-format",
            "json",
        ]
        if backend:
            command.extend(["--transcriber-backend", backend])
        if model_name:
            command.extend(["--transcriber-model-name", model_name])
        effective_model_path = model_path or str(self.default_model_store())
        command.extend(["--transcriber-model-path", str(Path(effective_model_path).expanduser())])
        if hf_xet:
            command.extend(["--transcriber-hf-xet", hf_xet])
        if hf_proxy:
            command.extend(["--transcriber-hf-proxy", hf_proxy])
        if hf_etag_timeout is not None:
            command.extend(["--transcriber-hf-etag-timeout", str(hf_etag_timeout)])
        if hf_download_timeout is not None:
            command.extend(["--transcriber-hf-download-timeout", str(hf_download_timeout)])
        if hf_max_workers is not None:
            command.extend(["--transcriber-hf-max-workers", str(hf_max_workers)])
        return command

    def legacy_dependency_status(self) -> tuple[bool, str | None, str | None]:
        try:
            version = importlib.metadata.version("py-roller")
        except importlib.metadata.PackageNotFoundError:
            version = None
        return False, version, "Legacy PATH py-roller is ignored; rollingpebble uses an isolated runtime."
