from __future__ import annotations

from pathlib import Path


def ensure_data_dirs(data_dir: Path) -> dict[str, Path]:
    paths = {
        "root": data_dir,
        "projects": data_dir / "projects",
        "cache": data_dir / "cache",
        "envs": data_dir / "envs",
        "models": data_dir / "models",
    }
    for path in paths.values():
        path.mkdir(parents=True, exist_ok=True)
    return paths
