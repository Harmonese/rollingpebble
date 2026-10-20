from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from rollingpebble.models import RuntimeSettingsModel
from rollingpebble.auto_timing.store import atomic_json

SETTINGS_JSON = "settings.json"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class SettingsStore:
    def __init__(self, data_dir: Path) -> None:
        self.path = data_dir / SETTINGS_JSON
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def read(self) -> RuntimeSettingsModel:
        if not self.path.exists():
            return RuntimeSettingsModel()
        data = json.loads(self.path.read_text(encoding="utf-8"))
        data.setdefault("model_onboarding_complete", True)
        data.setdefault("model_proxy_enabled", bool(data.get("auto_timing_hf_proxy")))
        if data.get("auto_timing_hf_download_timeout") is not None:
            data["auto_timing_hf_download_timeout"] = min(30, max(1, data["auto_timing_hf_download_timeout"]))
        data.setdefault("auto_timing_v2_options", {}).setdefault("alignment_mode", "unordered")
        data["auto_timing_v2_options"].setdefault("language", "auto")
        return RuntimeSettingsModel.model_validate(data)

    def write(self, settings: RuntimeSettingsModel) -> RuntimeSettingsModel:
        atomic_json(self.path, settings.model_dump())
        return settings

    def reset_defaults(self, *, preserve_runtime_history: bool = True) -> RuntimeSettingsModel:
        current = self.read()
        defaults = RuntimeSettingsModel()
        defaults.model_onboarding_complete = current.model_onboarding_complete
        defaults.model_prepared_kinds = current.model_prepared_kinds
        if preserve_runtime_history:
            for field in ("last_doctor_status", "last_doctor_at", "last_install_profile",
                          "last_install_at", "last_install_status"):
                setattr(defaults, field, getattr(current, field))
        return self.write(defaults)
