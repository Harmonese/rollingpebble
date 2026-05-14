from __future__ import annotations

import importlib.metadata

__version__ = "0.5.5"


def app_version() -> str:
    try:
        return importlib.metadata.version("lrc-roller")
    except importlib.metadata.PackageNotFoundError:
        return __version__
