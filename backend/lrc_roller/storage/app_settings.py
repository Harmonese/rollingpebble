from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from lrc_roller.models import RuntimeSettingsModel

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
        try:
            return RuntimeSettingsModel.model_validate_json(self.path.read_text(encoding="utf-8"))
        except Exception:
            return RuntimeSettingsModel()

    def write(self, settings: RuntimeSettingsModel) -> RuntimeSettingsModel:
        self.path.write_text(settings.model_dump_json(indent=2), encoding="utf-8")
        return settings

    def reset_defaults(self, *, preserve_runtime_history: bool = True) -> RuntimeSettingsModel:
        current = self.read()
        defaults = RuntimeSettingsModel()
        if preserve_runtime_history:
            defaults.last_doctor_status = current.last_doctor_status
            defaults.last_doctor_at = current.last_doctor_at
            defaults.last_install_profile = current.last_install_profile
            defaults.last_install_at = current.last_install_at
            defaults.last_install_status = current.last_install_status
        return self.write(defaults)
