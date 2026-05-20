from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class StorageLayout:
    app_root: Path
    projects_root: Path
    cache_root: Path
    runtime_root: Path
    models_root: Path
    work_root: Path

    @classmethod
    def from_data_dir(
        cls,
        data_dir: Path,
        *,
        projects_root: str | Path | None = None,
        cache_root: str | Path | None = None,
        runtime_root: str | Path | None = None,
        models_root: str | Path | None = None,
        work_root: str | Path | None = None,
    ) -> "StorageLayout":
        root = data_dir.expanduser()
        return cls(
            app_root=root,
            projects_root=Path(projects_root).expanduser() if projects_root else root / "projects",
            cache_root=Path(cache_root).expanduser() if cache_root else root / "cache",
            runtime_root=Path(runtime_root).expanduser() if runtime_root else root / "envs",
            models_root=Path(models_root).expanduser() if models_root else root / "models",
            work_root=Path(work_root).expanduser() if work_root else root / "work",
        )

    @property
    def data_dir(self) -> Path:
        return self.app_root

    def ensure(self) -> "StorageLayout":
        for path in (
            self.app_root,
            self.projects_root,
            self.cache_root,
            self.runtime_root,
            self.models_root,
            self.work_root,
        ):
            path.mkdir(parents=True, exist_ok=True)
        return self

    def as_legacy_dict(self) -> dict[str, Path]:
        return {
            "root": self.app_root,
            "projects": self.projects_root,
            "cache": self.cache_root,
            "envs": self.runtime_root,
            "models": self.models_root,
            "work": self.work_root,
        }


def ensure_data_dirs(data_dir: Path) -> dict[str, Path]:
    return StorageLayout.from_data_dir(data_dir).ensure().as_legacy_dict()


def storage_layout_from_settings(data_dir: Path, settings: object) -> StorageLayout:
    return StorageLayout.from_data_dir(
        data_dir,
        projects_root=getattr(settings, "storage_projects_root", "") or None,
        cache_root=getattr(settings, "storage_cache_root", "") or None,
        runtime_root=getattr(settings, "storage_runtime_root", "") or None,
        models_root=getattr(settings, "storage_models_root", "") or None,
        work_root=getattr(settings, "storage_work_root", "") or None,
    )


def ensure_storage_layout(data_dir: Path, settings: object | None = None) -> StorageLayout:
    layout = storage_layout_from_settings(data_dir, settings) if settings is not None else StorageLayout.from_data_dir(data_dir)
    return layout.ensure()
