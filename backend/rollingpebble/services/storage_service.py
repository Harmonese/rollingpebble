from __future__ import annotations

from pathlib import Path

from rollingpebble.jobs import JobManager
from rollingpebble.paths import StorageLayout
from rollingpebble.runtime.manager import RuntimeManager
from rollingpebble.services.storage_cleanup import StorageCleanupMixin
from rollingpebble.services.storage_migration import StorageMigrationMixin
from rollingpebble.services.storage_shared import CachedCleanupPlan
from rollingpebble.services.storage_usage import StorageUsageMixin
from rollingpebble.storage.app_settings import SettingsStore


class StorageService(StorageCleanupMixin, StorageMigrationMixin, StorageUsageMixin):
    def __init__(
        self,
        *,
        data_dir: Path | None = None,
        layout: StorageLayout | None = None,
        jobs: JobManager,
        runtime_manager: RuntimeManager | None = None,
    ) -> None:
        if layout is None and data_dir is None:
            raise ValueError("StorageService requires data_dir or layout")
        if layout is None:
            assert data_dir is not None
            layout = StorageLayout.from_data_dir(data_dir)
        self.layout = layout
        self.data_dir = self.layout.app_root.expanduser().resolve()
        self.projects_root = self.layout.projects_root.expanduser().resolve()
        self.jobs = jobs
        self.runtime_manager = runtime_manager or RuntimeManager(self.layout)
        self.settings_store = SettingsStore(self.data_dir)
        self._plans: dict[str, CachedCleanupPlan] = {}


    def update_layout(self, layout: StorageLayout) -> None:
        self.layout = layout
        self.data_dir = self.layout.app_root.expanduser().resolve()
        self.projects_root = self.layout.projects_root.expanduser().resolve()
        self.runtime_manager.update_layout(layout)
        self.settings_store = SettingsStore(self.data_dir)
