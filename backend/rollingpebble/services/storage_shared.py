from __future__ import annotations

import time
from dataclasses import dataclass, field

from rollingpebble.models import StorageCleanupPlanResponse
from rollingpebble.storage.files import AUDIO_NAME, PLAIN_NAME, PROJECT_JSON, PYROLLER_NAME, SYNCED_NAME


@dataclass(slots=True)
class CachedCleanupPlan:
    plan: StorageCleanupPlanResponse
    created_at: float = field(default_factory=time.time)


CATEGORY_LABELS: dict[str, str] = {
    "projects": "Projects",
    "models": "Models",
    "runtime_envs": "Runtime Environments",
    "other": "Other",
}

CATEGORY_DESCRIPTIONS: dict[str, str] = {
    "projects": "Project folders, including audio, lyrics, generated outputs, artifacts, and intermediates.",
    "models": "Downloaded model caches under the rollingpebble models directory.",
    "runtime_envs": "Isolated py-roller Python environments.",
    "other": "Known app data and unclassified files under the rollingpebble data directory.",
}

AUDIO_PREFIX = f"{AUDIO_NAME}."
LYRICS_OUTPUT_FILES = {PROJECT_JSON, PLAIN_NAME, SYNCED_NAME, PYROLLER_NAME}
GENERATED_DIRS = {"intermediate", "artifacts"}
PLAN_TTL_SECONDS = 30 * 60
IGNORED_SYSTEM_NAMES = {".DS_Store", ".Spotlight-V100", ".Trashes", ".fseventsd"}
IGNORED_MODEL_NAMES = {*IGNORED_SYSTEM_NAMES, ".locks"}
IGNORED_OTHER_NAMES = set(IGNORED_SYSTEM_NAMES)
