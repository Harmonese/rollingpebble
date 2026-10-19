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
        if request.auto_timing_v2_options is not None:
            from rollingpebble.auto_timing.contracts import Options
            request.auto_timing_v2_options = Options.model_validate(request.auto_timing_v2_options).model_dump()
        settings = self.store.read()
        enabled = request.model_proxy_enabled if request.model_proxy_enabled is not None else settings.model_proxy_enabled
        proxy = request.auto_timing_hf_proxy if request.auto_timing_hf_proxy is not None else settings.auto_timing_hf_proxy
        if enabled:
            from rollingpebble.auto_timing.model_download import validate_proxy
            validate_proxy(proxy)
        for field, value in request.model_dump(exclude_unset=True).items():
            if value is not None or field in {
                "auto_timing_hf_etag_timeout",
                "auto_timing_hf_download_timeout",
            }:
                setattr(settings, field, value)
        return self.store.write(settings)

    def reset_defaults(self) -> RuntimeSettingsModel:
        result = self.store.reset_defaults(preserve_runtime_history=True)
        bg_path = self.store.path.parent / "workspace-bg"
        if bg_path.exists():
            bg_path.unlink()
        return result
