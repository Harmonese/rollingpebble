from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass


RUNTIME_PYTHON_VERSION = (3, 12)
PREFERRED_RUNTIME_PYTHONS = ("python3.12",)


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


def select_runtime_python() -> RuntimePython:
    override = os.environ.get("LRC_ROLLER_RUNTIME_PYTHON", "").strip()
    candidates = [override] if override else []
    current = (sys.version_info.major, sys.version_info.minor)
    if _supported(current):
        candidates.append(sys.executable)
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
        f"is not available for Python {current_text}. Install Python 3.12, or set "
        "LRC_ROLLER_RUNTIME_PYTHON to a Python 3.12 executable."
    )
