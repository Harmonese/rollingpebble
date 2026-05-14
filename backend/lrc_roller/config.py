from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 6789
DEFAULT_DATA_DIR = Path.home() / ".local" / "share" / "lrc-roller"


@dataclass(slots=True)
class Settings:
    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    data_dir: Path = DEFAULT_DATA_DIR
    frontend_dist: Path | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        data_dir = Path(os.getenv("LRC_ROLLER_DATA_DIR", str(DEFAULT_DATA_DIR))).expanduser()
        frontend_dist_raw = os.getenv("LRC_ROLLER_FRONTEND_DIST")
        return cls(
            host=os.getenv("LRC_ROLLER_HOST", DEFAULT_HOST),
            port=int(os.getenv("LRC_ROLLER_PORT", str(DEFAULT_PORT))),
            data_dir=data_dir,
            frontend_dist=Path(frontend_dist_raw).expanduser() if frontend_dist_raw else None,
        )


def _valid_frontend_dist(candidate: Path | None) -> Path | None:
    if candidate is None:
        return None
    return candidate if (candidate / "index.html").exists() else None


def frontend_dist_from_package() -> Path | None:
    """Return bundled frontend assets from an installed wheel, if present."""
    return _valid_frontend_dist(Path(__file__).resolve().parent / "frontend_dist")


def frontend_dist_from_repo() -> Path | None:
    """Return Vite build output from a source checkout, if present."""
    root = Path(__file__).resolve().parents[2]
    return _valid_frontend_dist(root / "frontend" / "dist")


def resolve_frontend_dist(settings: Settings) -> Path | None:
    """Resolve frontend assets in explicit, bundled, then source-checkout order."""
    return (
        _valid_frontend_dist(settings.frontend_dist)
        or frontend_dist_from_package()
        or frontend_dist_from_repo()
    )
