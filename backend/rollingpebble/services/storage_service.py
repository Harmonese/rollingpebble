from __future__ import annotations

import shutil
import json
from pathlib import Path

from rollingpebble.models import StorageCategoryModel, StorageProjectModel, StorageUsageResponse
from rollingpebble.paths import StorageLayout
from rollingpebble.services.storage_inventory import inventory
from rollingpebble.storage.files import read_project


class StorageService:
    def __init__(self, *, data_dir=None, layout=None, jobs, runtime_manager=None):
        self.layout = layout or StorageLayout.from_data_dir(data_dir)
        self.jobs = jobs
        self.relocating = False
        self.migration = {"status": "idle"}
        self.runtime_manager = runtime_manager
        self.update_layout(self.layout)
        pending = self.data_dir / ".relocation.json"
        if pending.exists():
            self.migration = {"status": "failed", "target": json.loads(pending.read_text())["target"]}

    def update_layout(self, layout):
        self.layout = layout
        self.data_dir = layout.app_root
        self.projects_root = layout.projects_root

    def usage(self):
        paths, counts = inventory(self.layout)
        projects = []
        if self.projects_root.exists():
            for path in self.projects_root.iterdir():
                if not path.is_dir() or path.is_symlink() or path.name.startswith("."):
                    continue
                try:
                    project = read_project(self.projects_root, path.name)
                except (ValueError, OSError, KeyError):
                    continue
                size, count = tree_stats(path)
                projects.append(StorageProjectModel(project_id=path.name,
                    title=project.metadata.track or project.audio_name or path.name,
                    artist=project.metadata.artist or "", total_bytes=size, file_count=count,
                    updated_at=project.last_opened_at))
        labels = dict(projects="Projects", models="Models", results="Task Results",
                      cache="Cache", components="Components")
        categories = [StorageCategoryModel(id=key, label=labels[key], bytes=value[0],
                       file_count=value[1], path=str(paths[key])) for key, value in counts.items()]
        return StorageUsageResponse(data_dir=str(self.data_dir),
            migration=self.migration,
            total_bytes=sum(value[0] for value in counts.values()),
            file_count=sum(value[1] for value in counts.values()), categories=categories, projects=projects)

    def clear_cache(self):
        paths = [self.layout.cache_root / name for name in
                 ("pip", "xdg", "torch", "huggingface", "jobs", "temporary", "model-downloads")]
        paths += [self.layout.engine_root / name for name in ("ctc", "whisper", "separation")]
        for path in paths:
            if path.is_symlink() or any(path.rglob("*.lock")):
                raise ValueError("Inspect cache locks before cleanup")
        for path in paths:
            if path.is_dir():
                shutil.rmtree(path)
        return self.usage()


def tree_stats(path: Path):
    size = count = 0
    for item in path.rglob("*"):
        if item.is_file() and not item.is_symlink():
            size += item.stat().st_size
            count += 1
    return size, count
