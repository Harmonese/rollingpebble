from __future__ import annotations

from pathlib import Path


def ensure_data_dirs(data_dir: Path) -> dict[str, Path]:
    paths = {
        "root": data_dir,
        "projects": data_dir / "projects",
        "uploads": data_dir / "uploads",
        "outputs": data_dir / "outputs",
        "cache": data_dir / "cache",
        "logs": data_dir / "logs",
    }
    for path in paths.values():
        path.mkdir(parents=True, exist_ok=True)
    return paths
