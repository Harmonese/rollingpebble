"""Small redo journal: readers finish an interrupted multi-file save before loading it."""
import json
import os
from pathlib import Path
import threading
import uuid

SAVE_LOCK = threading.RLock()
JOURNAL = ".pending-save.json"


def atomic_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}-{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("w", encoding="utf-8", newline="") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
        if os.name != "nt":
            fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
    finally:
        temporary.unlink(missing_ok=True)


def recover(folder: Path) -> None:
    journal = folder / JOURNAL
    if not journal.exists():
        return
    record = json.loads(journal.read_text(encoding="utf-8"))
    for name, value in record["files"].items():
        if Path(name).name != name or name.startswith("."):
            raise ValueError("Invalid save journal")
        atomic_text(folder / name, value)
    for name in record.get("remove", []):
        if Path(name).name != name or name.startswith("."):
            raise ValueError("Invalid save cleanup")
        (folder / name).unlink(missing_ok=True)
    journal.unlink()


def commit(folder: Path, files: dict[str, str], *, remove: tuple[str, ...] = ()) -> None:
    with SAVE_LOCK:
        recover(folder)
        atomic_text(folder / JOURNAL, json.dumps({"files": files, "remove": remove}, ensure_ascii=False))
        recover(folder)
