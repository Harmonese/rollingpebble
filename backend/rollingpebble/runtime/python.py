from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


RUNTIME_PYTHON_VERSION = (3, 12)
PREFERRED_RUNTIME_PYTHONS = ("python3.12",)
BUNDLED_RUNTIME_DIR_NAME = "python-runtime"
USER_TOOLCHAIN_DIR_NAME = "toolchains"


def target_runtime_python_tag() -> str:
    return f"py{RUNTIME_PYTHON_VERSION[0]}{RUNTIME_PYTHON_VERSION[1]}"


@dataclass(frozen=True)
class RuntimePython:
    executable: str
    major: int
    minor: int

    @property
    def tag(self) -> str:
        return f"py{self.major}{self.minor}"


def _bundled_python_candidates() -> list[Path]:
    override = os.environ.get("ROLLINGPEBBLE_BUNDLED_PYTHON", "").strip()
    candidates: list[Path] = []
    if override:
        candidates.append(Path(override).expanduser())

    resources_override = os.environ.get("ROLLINGPEBBLE_APP_RESOURCES", "").strip()
    if resources_override:
        candidates.append(Path(resources_override).expanduser() / BUNDLED_RUNTIME_DIR_NAME / "bin" / "python3.12")

    if getattr(sys, "frozen", False):
        executable_dir = Path(sys.executable).resolve().parent
        # PyInstaller's sidecar is in Contents/Resources/bin; a direct frozen
        # executable may instead be in Contents/MacOS.
        resources_dir = executable_dir.parent
        candidates.append(resources_dir / BUNDLED_RUNTIME_DIR_NAME / "bin" / "python3.12")
        candidates.append(resources_dir / "Resources" / BUNDLED_RUNTIME_DIR_NAME / "bin" / "python3.12")
        candidates.append(resources_dir.parent / "Resources" / BUNDLED_RUNTIME_DIR_NAME / "bin" / "python3.12")
        candidates.append(resources_dir / BUNDLED_RUNTIME_DIR_NAME / "python" / "bin" / "python3.12")
    return candidates


def bundled_runtime_python() -> Path | None:
    for candidate in _bundled_python_candidates():
        if candidate.is_file() and _version_for(str(candidate)) == RUNTIME_PYTHON_VERSION:
            return candidate
    return None


def _bundled_runtime_root(python: Path) -> Path:
    return python.parent.parent


def prepare_bundled_runtime(data_dir: Path) -> Path | None:
    source_python = bundled_runtime_python()
    if source_python is None:
        return None

    target_root = data_dir.expanduser() / USER_TOOLCHAIN_DIR_NAME / "python3.12"
    target_python = target_root / "bin" / "python3.12"
    if target_python.is_file() and _version_for(str(target_python)) == RUNTIME_PYTHON_VERSION:
        return target_python

    target_root.parent.mkdir(parents=True, exist_ok=True)
    staging_root = target_root.with_name(f".{target_root.name}.installing")
    if staging_root.exists():
        shutil.rmtree(staging_root)
    shutil.copytree(_bundled_runtime_root(source_python), staging_root, symlinks=True)
    if _version_for(str(staging_root / "bin" / "python3.12")) != RUNTIME_PYTHON_VERSION:
        raise RuntimeError("Copied bundled Python failed validation")
    if target_root.exists():
        shutil.rmtree(target_root)
    staging_root.replace(target_root)
    if not target_python.is_file() or _version_for(str(target_python)) != RUNTIME_PYTHON_VERSION:
        raise RuntimeError(f"Bundled Python 3.12 could not be prepared at {target_python}")
    return target_python


def _version_for(executable: str) -> tuple[int, int] | None:
    try:
        result = subprocess.run(
            [
                executable,
                "-c",
                "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except Exception:
        return None
    parts = result.stdout.strip().split(".", 1)
    if len(parts) != 2:
        return None
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return None


def _supported(version: tuple[int, int]) -> bool:
    return version == RUNTIME_PYTHON_VERSION


def select_runtime_python(data_dir: Path | None = None) -> RuntimePython:
    override = os.environ.get("LRC_ROLLER_RUNTIME_PYTHON", "").strip()
    candidates = [override] if override else []
    bundled = prepare_bundled_runtime(data_dir) if data_dir is not None else bundled_runtime_python()
    if bundled is not None:
        candidates.append(str(bundled))
    current = (sys.version_info.major, sys.version_info.minor)
    if _supported(current) and not getattr(sys, "frozen", False):
        candidates.append(sys.executable)
    if not getattr(sys, "frozen", False):
        candidates.extend(PREFERRED_RUNTIME_PYTHONS)

    seen: set[str] = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        executable = shutil.which(candidate) or candidate
        version = current if executable == sys.executable else _version_for(executable)
        if version and _supported(version):
            return RuntimePython(executable=executable, major=version[0], minor=version[1])

    current_text = f"{sys.version_info.major}.{sys.version_info.minor}"
    raise RuntimeError(
        "Auto Timing runtime requires Python 3.12 because py-roller's runtime dependency stack "
        f"is not available for Python {current_text}. The bundled Python runtime is missing or "
        "could not be prepared. Reinstall the application, or set LRC_ROLLER_RUNTIME_PYTHON "
        "to a Python 3.12 executable."
    )
