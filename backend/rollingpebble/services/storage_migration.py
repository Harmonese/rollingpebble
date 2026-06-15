from __future__ import annotations

import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from rollingpebble.models import (
    StorageMigrateRootResponse,
)
from rollingpebble.paths import StorageLayout


class StorageMigrationMixin:
    def migrate_root(self, root_id: str, target_path: str) -> StorageMigrateRootResponse:
        if root_id not in {"projects", "models", "cache", "work"}:
            raise ValueError(f"Storage root cannot be moved: {root_id}")
        if self._running_jobs():
            raise RuntimeError("Storage roots cannot be moved while jobs are running.")

        source = self._root_path(root_id).expanduser().resolve()
        target = Path(target_path).expanduser().resolve()
        if source == target:
            raise ValueError("Target path is already the active storage location.")
        if self._is_relative_to(target, source) or self._is_relative_to(source, target):
            raise ValueError("Target path cannot be inside the current storage root or contain it.")
        target_parent = target.parent
        target_parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and any(target.iterdir()):
            raise ValueError("Target directory must be empty.")

        source.mkdir(parents=True, exist_ok=True)
        moved_bytes, file_count = self._tree_stats(source)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        tmp = target_parent / f".{target.name}.rollingpebble-migrate-{stamp}-{uuid.uuid4().hex[:8]}"
        backup = source.parent / f"{source.name}.backup-{stamp}"
        try:
            shutil.copytree(source, tmp, symlinks=True)
            if target.exists():
                target.rmdir()
            tmp.rename(target)
            if source.exists() and not source.is_symlink():
                backup_candidate = backup
                index = 1
                while backup_candidate.exists():
                    backup_candidate = source.parent / f"{source.name}.backup-{stamp}-{index}"
                    index += 1
                source.rename(backup_candidate)
                backup = backup_candidate
            else:
                backup = None
        except Exception:
            if tmp.exists():
                shutil.rmtree(tmp, ignore_errors=True)
            raise

        settings = self.settings_store.read()
        setattr(settings, self._settings_field_for_root(root_id), str(target))
        self.settings_store.write(settings)
        new_layout = StorageLayout.from_data_dir(
            self.data_dir,
            projects_root=settings.storage_projects_root or None,
            models_root=settings.storage_models_root or None,
            cache_root=settings.storage_cache_root or None,
            runtime_root=settings.storage_runtime_root or None,
            work_root=settings.storage_work_root or None,
        ).ensure()
        self.update_layout(new_layout)
        usage = self.usage()
        root = next(item for item in usage.roots if item.id == root_id)
        return StorageMigrateRootResponse(
            root=root,
            old_path=str(source),
            backup_path=str(backup) if backup else None,
            moved_bytes=moved_bytes,
            file_count=file_count,
            usage=usage,
        )


    def _root_path(self, root_id: str) -> Path:
        if root_id == "app":
            return self.layout.app_root
        if root_id == "projects":
            return self.layout.projects_root
        if root_id == "models":
            return self.layout.models_root
        if root_id == "cache":
            return self.layout.cache_root
        if root_id == "runtime":
            return self.layout.runtime_root
        if root_id == "work":
            return self.layout.work_root
        raise ValueError(f"Unknown storage root: {root_id}")


    def _settings_field_for_root(self, root_id: str) -> str:
        return {
            "projects": "storage_projects_root",
            "models": "storage_models_root",
            "cache": "storage_cache_root",
            "runtime": "storage_runtime_root",
            "work": "storage_work_root",
        }[root_id]


