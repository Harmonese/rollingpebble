from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

ACTIVE = {"queued", "running", "cancelling"}


def now():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temp.open("w", encoding="utf-8") as file:
            json.dump(value, file, ensure_ascii=False, allow_nan=False)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


class RunStore:
    def __init__(self, root: Path):
        self.root = root
        self.lock = threading.RLock()
        self.root.mkdir(parents=True, exist_ok=True)
        for path in self.root.glob("*/*/record.json"):
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                continue
            if record.get("status") in ACTIVE:
                self._reap_interrupted(record, path.parent)
                record.update(status="interrupted", updated_at=now())
                atomic_json(path, record)
                (path.parent / "audio.snapshot").unlink(missing_ok=True)

    @staticmethod
    def _reap_interrupted(record, folder):
        pid = record.get("engine_pid")
        if not pid or os.name == "nt":
            return
        # PID reuse must never terminate an unrelated process. The request path is
        # unique per run; engines are launched in their own process group.
        def matches():
            result = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "command="],
                                    capture_output=True, text=True, timeout=5)
            return result.returncode == 0 and result.stdout.strip().endswith(
                f" -m pyroller run --request {folder / 'request.json'}")
        try:
            if not matches() or os.getpgid(pid) != pid:
                return
            os.killpg(pid, signal.SIGTERM)
            deadline = time.monotonic() + 8
            while matches() and time.monotonic() < deadline:
                time.sleep(.1)
            if matches():
                os.killpg(pid, signal.SIGKILL)
                deadline = time.monotonic() + 5
                while matches() and time.monotonic() < deadline:
                    time.sleep(.1)
                if matches():
                    raise RuntimeError("Interrupted engine is still running")
        except ProcessLookupError:
            pass

    def folder(self, run_id: str) -> Path:
        if not re.fullmatch(r"[a-f0-9]{32}", run_id):
            raise FileNotFoundError(run_id)
        matches = list(self.root.glob(f"*/{run_id}/record.json"))
        if len(matches) != 1:
            raise FileNotFoundError(run_id)
        return matches[0].parent

    def create(self, record):
        project = record.get("project_id") or "batches"
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", project):
            raise ValueError("Invalid project identity")
        folder = self.root / project / record["id"]
        folder.mkdir(parents=True, exist_ok=False)
        atomic_json(folder / "record.json", record)
        return folder

    @staticmethod
    def normalize(record):
        record.setdefault("options", {}).setdefault("alignment_mode", "unordered")
        return record

    def get(self, run_id):
        with self.lock:
            return self.normalize(json.loads((self.folder(run_id) / "record.json").read_text(encoding="utf-8")))

    def update(self, run_id, **values):
        with self.lock:
            record = self.get(run_id)
            record.update(values, updated_at=now())
            atomic_json(self.folder(run_id) / "record.json", record)
            return record

    def list(self, project_id=None):
        with self.lock:
            records = []
            for path in self.root.glob("*/*/record.json"):
                try:
                    records.append(self.normalize(json.loads(path.read_text(encoding="utf-8"))))
                except (ValueError, OSError):
                    continue
        return sorted([r for r in records if project_id is None or r.get("project_id") == project_id],
                      key=lambda r: r["created_at"], reverse=True)

    def draft(self, run_id):
        with self.lock:
            path = self.folder(run_id) / "draft.json"
            return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {
                "version": 0, "base_revision": 0, "lines": None,
            }

    def save_draft(self, run_id, update):
        with self.lock:
            current = self.draft(run_id)
            if update.version != current["version"]:
                raise FileExistsError("Draft changed; reload before saving")
            if update.base_revision > (self.get(run_id).get("snapshot") or {}).get("revision", 0):
                raise ValueError("Unknown snapshot revision")
            ids = [line.id for line in update.lines or []]
            if len(ids) != len(set(ids)):
                raise ValueError("Duplicate draft row identity")
            value = update.model_dump()
            value["version"] += 1
            value["updated_at"] = now()
            atomic_json(self.folder(run_id) / "draft.json", value)
            return value
