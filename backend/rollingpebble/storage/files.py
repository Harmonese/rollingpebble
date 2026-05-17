from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import UploadFile

from rollingpebble.lyrics_utils import clean_plain_lyrics, is_lrc_metadata_line, normalize_newlines, strip_leading_timestamps

from rollingpebble.models import MetaModel, ProjectModel

PROJECT_JSON = "project.json"
AUDIO_NAME = "audio"
PLAIN_NAME = "plain.txt"
SYNCED_NAME = "synced.lrc"
PYROLLER_NAME = "pyroller_output.lrc"


def new_project_id() -> str:
    return uuid.uuid4().hex[:12]


def project_dir(projects_root: Path, project_id: str) -> Path:
    candidate = projects_root / project_id
    try:
        candidate.resolve(strict=False).relative_to(projects_root.resolve(strict=False))
    except ValueError as exc:
        raise FileNotFoundError(f"Project not found: {project_id}") from exc
    return candidate


def read_project(projects_root: Path, project_id: str) -> ProjectModel:
    path = project_dir(projects_root, project_id) / PROJECT_JSON
    if not path.exists():
        raise FileNotFoundError(f"Project not found: {project_id}")
    return ProjectModel.model_validate_json(path.read_text(encoding="utf-8"))


def write_project(projects_root: Path, project: ProjectModel) -> None:
    root = project_dir(projects_root, project.project_id)
    root.mkdir(parents=True, exist_ok=True)
    (root / PROJECT_JSON).write_text(project.model_dump_json(indent=2), encoding="utf-8")


def write_text(projects_root: Path, project_id: str, filename: str, text: str) -> Path:
    path = project_dir(projects_root, project_id) / filename
    path.write_text(text or "", encoding="utf-8")
    return path


def read_text(projects_root: Path, project_id: str, filename: str) -> str:
    path = project_dir(projects_root, project_id) / filename
    return path.read_text(encoding="utf-8") if path.exists() else ""


def safe_suffix(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    return suffix if suffix else ".audio"


async def save_upload_file(projects_root: Path, project_id: str, upload: UploadFile) -> Path:
    root = project_dir(projects_root, project_id)
    root.mkdir(parents=True, exist_ok=True)
    destination = root / f"{AUDIO_NAME}{safe_suffix(upload.filename or '')}"
    with destination.open("wb") as out:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
    return destination


def derive_plain_from_synced(synced: str) -> str:
    lines: list[str] = []
    for line in normalize_newlines(synced).splitlines():
        if is_lrc_metadata_line(line):
            continue
        text = strip_leading_timestamps(line)
        if text:
            lines.append(text)
    return "\n".join(lines).strip()


def plain_for_timing(plain: str, synced: str = "") -> str:
    """Return lyric-only text suitable for py-roller.

    Metadata-only editor content such as [ti:...], [ar:...], [length:...]
    should not make a project look ready and must never be passed to
    py-roller as lyric lines.
    """
    return clean_plain_lyrics(plain) or derive_plain_from_synced(synced)
