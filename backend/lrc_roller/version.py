from __future__ import annotations

import importlib.metadata
from pathlib import Path


def _read_version_from_pyproject() -> str:
    """Fallback: read version from pyproject.toml when package is not installed."""
    try:
        pyproject = Path(__file__).resolve().parents[3] / "pyproject.toml"
        for line in pyproject.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("version"):
                return stripped.split("=", 1)[1].strip().strip('"')
    except Exception:
        pass
    return "0.0.0"


def app_version() -> str:
    try:
        return importlib.metadata.version("lrc-roller")
    except importlib.metadata.PackageNotFoundError:
        return _read_version_from_pyproject()


__version__ = app_version()
