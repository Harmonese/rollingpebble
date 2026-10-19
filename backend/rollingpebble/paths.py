from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class StorageLayout:
    app_root: Path

    @classmethod
    def from_data_dir(cls, data_dir: Path) -> "StorageLayout":
        return cls(data_dir.expanduser().resolve())

    @property
    def data_dir(self): return self.app_root

    @property
    def projects_root(self): return self.app_root / "projects"

    @property
    def cache_root(self): return self.app_root / "cache"

    @property
    def runtime_root(self): return self.app_root / "runtime"

    @property
    def engine_root(self): return self.app_root / "engine"

    @property
    def models_root(self): return self.engine_root / "models"

    @property
    def results_root(self): return self.app_root / "results"

    @property
    def work_root(self): return self.cache_root

    def ensure(self) -> "StorageLayout":
        for path in (self.app_root, self.projects_root, self.cache_root, self.runtime_root,
                     self.engine_root, self.results_root):
            path.mkdir(parents=True, exist_ok=True)
        return self


@dataclass(slots=True)
class StorageLayoutRef:
    current: StorageLayout

    def update(self, layout: StorageLayout) -> None:
        self.current = layout


def ensure_storage_layout(data_dir: Path, settings: object | None = None) -> StorageLayout:
    return StorageLayout.from_data_dir(data_dir).ensure()
