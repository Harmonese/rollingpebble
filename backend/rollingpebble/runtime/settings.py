from __future__ import annotations

from pathlib import Path

from rollingpebble.models import RuntimeSettingsModel, RuntimeSettingsUpdateRequest
from rollingpebble.storage.app_settings import SettingsStore


class RuntimeSettingsService:
    def __init__(self, data_dir: Path) -> None:
        self.store = SettingsStore(data_dir)

    @property
    def path(self) -> Path:
        return self.store.path

    def update_data_dir(self, data_dir: Path) -> None:
        self.store = SettingsStore(data_dir)

    def read(self) -> RuntimeSettingsModel:
        return self.store.read()

    def write(self, settings: RuntimeSettingsModel) -> RuntimeSettingsModel:
        return self.store.write(settings)

    def update(self, request: RuntimeSettingsUpdateRequest) -> RuntimeSettingsModel:
        settings = self.store.read()
        for field, value in request.model_dump(exclude_unset=True).items():
            if value is not None or field in {
                "auto_timing_hf_etag_timeout",
                "auto_timing_hf_download_timeout",
                "auto_timing_hf_max_workers",
                "auto_timing_splitter_demucs_jobs",
                "auto_timing_splitter_demucs_overlap",
                "auto_timing_splitter_demucs_segment",
                "auto_timing_transcriber_batch_size",
                "auto_timing_aligner_min_gap",
            }:
                setattr(settings, field, value)
        return self.store.write(settings)

    def reset_defaults(self) -> RuntimeSettingsModel:
        result = self.store.reset_defaults(preserve_runtime_history=True)
        bg_path = self.store.path.parent / "workspace-bg"
        if bg_path.exists():
            bg_path.unlink()
        return result
