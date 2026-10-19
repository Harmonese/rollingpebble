from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from rollingpebble.auto_timing.store import atomic_json


def location_file():
    override = os.getenv("ROLLINGPEBBLE_LOCATION_FILE")
    if override:
        return Path(override).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/Rolling Pebble/storage.json"
    if os.name == "nt":
        return Path(os.environ["APPDATA"]) / "Rolling Pebble/storage.json"
    return Path(os.getenv("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "rollingpebble/storage.json"


def selected_root(default):
    file = location_file()
    if not file.exists():
        return default
    root = Path(json.loads(file.read_text())["path"])
    if not root.is_dir():
        raise RuntimeError(f"Application data directory is unavailable: {root}")
    return root


def select_root(root):
    atomic_json(location_file(), {"path": str(root)})
