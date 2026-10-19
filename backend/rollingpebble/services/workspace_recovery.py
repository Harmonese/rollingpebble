"""One current workspace, separate from persistent projects and disposable caches."""
import os
import shutil
import uuid
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from rollingpebble.models import WorkspaceSaveRequest
from rollingpebble.storage.transaction import SAVE_LOCK, atomic_text


class RecoveryRecord(BaseModel):
    version: Literal[1] = 1
    project_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{12,32}$")
    draft_id: uuid.UUID
    snapshot: WorkspaceSaveRequest
    dirty: bool
    audio_key: uuid.UUID | None = None
    audio_name: str | None = None
    editor: dict | None = None


class WorkspaceRecovery:
    def __init__(self, projects):
        self.projects = projects

    @property
    def root(self) -> Path:
        return self.projects.projects_root.parent / "recovery"

    def read(self):
        with SAVE_LOCK:
            path = self.root / "workspace.json"
            return RecoveryRecord.model_validate_json(path.read_text(encoding="utf-8")) if path.exists() else None

    def write(self, record: RecoveryRecord, audio=None):
        with SAVE_LOCK:
            self.root.mkdir(parents=True, exist_ok=True)
            if record.audio_key:
                destination = self.root / f"{record.audio_key}.audio"
                if not destination.exists():
                    if audio is None:
                        raise ValueError("Recovery audio is missing")
                    temporary = self.root / "upload.tmp"
                    try:
                        with temporary.open("wb") as stream:
                            shutil.copyfileobj(audio.file, stream)
                            stream.flush()
                            os.fsync(stream.fileno())
                        temporary.replace(destination)
                    finally:
                        temporary.unlink(missing_ok=True)
            atomic_text(self.root / "workspace.json", record.model_dump_json())
            self._clean(record.audio_key)
            return record

    def _clean(self, keep=None):
        for path in self.root.glob("*.audio"):
            if path.name != f"{keep}.audio":
                path.unlink(missing_ok=True)

    def clear(self):
        with SAVE_LOCK:
            (self.root / "workspace.json").unlink(missing_ok=True)
            self._clean()

    def audio(self, key: uuid.UUID):
        record = self.read()
        if record is None or record.audio_key != key:
            raise FileNotFoundError("Recovery audio is missing")
        path = self.root / f"{key}.audio"
        if not path.is_file():
            raise FileNotFoundError("Recovery audio is missing")
        return path
