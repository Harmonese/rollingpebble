from __future__ import annotations

import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import UploadFile

from rollingpebble.models import ApplyLyricsRequest, MetaModel, ProjectModel, RuntimeSettingsModel, SaveEditorRequest
from rollingpebble.lyrics_utils import merge_lrc_metadata_header
from rollingpebble.storage.files import (
    PLAIN_NAME,
    PYROLLER_NAME,
    SYNCED_NAME,
    derive_plain_from_synced,
    plain_for_timing,
    new_project_id,
    read_project,
    read_text,
    save_upload_file,
    write_project,
    write_text,
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

class ProjectService:
    def __init__(self, projects_root: Path) -> None:
        self.projects_root = projects_root

    async def create_from_audio(
        self, upload: UploadFile, *, settings: RuntimeSettingsModel | None = None,
    ) -> ProjectModel:
        project_id = new_project_id()
        audio_path = await save_upload_file(self.projects_root, project_id, upload)
        meta = self._read_audio_meta(audio_path).model_copy()
        filename = upload.filename or audio_path.name
        stem = Path(filename).stem

        if settings and settings.audio_filename_regex_enabled and settings.audio_filename_regex:
            try:
                pattern = re.compile(settings.audio_filename_regex)
                match = pattern.search(stem)
                if match:
                    groups = match.groupdict()
                    if "track" in groups and groups["track"]:
                        meta.track = groups["track"].strip()
                    if "artist" in groups and groups["artist"]:
                        meta.artist = groups["artist"].strip()
                    if "album" in groups and groups["album"]:
                        meta.album = groups["album"].strip()
                    if "duration" in groups and groups["duration"]:
                        try:
                            meta.duration = int(groups["duration"].strip())
                        except ValueError:
                            pass
            except re.error:
                pass

        project = ProjectModel(
            project_id=project_id,
            last_opened_at=_utc_now_iso(),
            audio_name=upload.filename,
            audio_path=str(audio_path),
            metadata=meta,
        )
        write_project(self.projects_root, project)
        return project

    def get(self, project_id: str, *, touch: bool = False) -> ProjectModel:
        project = read_project(self.projects_root, project_id)
        project.plain_lyrics = read_text(self.projects_root, project_id, PLAIN_NAME)
        project.synced_lyrics = read_text(self.projects_root, project_id, SYNCED_NAME)
        if touch:
            project.last_opened_at = _utc_now_iso()
            write_project(self.projects_root, project)
        return project

    def list_projects(self) -> list[ProjectModel]:
        projects: list[ProjectModel] = []
        if not self.projects_root.exists():
            return projects
        for candidate in sorted(self.projects_root.iterdir(), reverse=True):
            if not candidate.is_dir():
                continue
            try:
                projects.append(self.get(candidate.name, touch=False))
            except Exception:
                continue
        # Sort by directory modification time (≈ creation time), newest first.
        projects.sort(key=lambda p: (self.projects_root / p.project_id).stat().st_mtime, reverse=True)
        return projects

    def _write_lyrics(self, project_id: str, synced: str, *, metadata: MetaModel | None = None) -> ProjectModel:
        project = self.get(project_id)
        if metadata is not None:
            project.metadata = metadata
        plain = plain_for_timing("", synced)
        write_text(self.projects_root, project_id, PLAIN_NAME, plain)
        write_text(self.projects_root, project_id, SYNCED_NAME, synced)
        project.plain_lyrics = plain
        project.synced_lyrics = synced
        write_project(self.projects_root, project)
        return project

    def apply_lyrics(self, project_id: str, request: ApplyLyricsRequest) -> ProjectModel:
        synced = request.synced_lyrics or ""
        project = self._write_lyrics(project_id, synced, metadata=request.metadata)
        # _write_lyrics calls plain_for_timing with empty plain since synced is the
        # source of truth here. Re-derive plain including any explicit plain input.
        if request.plain_lyrics:
            composite_plain = plain_for_timing(request.plain_lyrics, synced)
            if composite_plain != project.plain_lyrics:
                write_text(self.projects_root, project_id, PLAIN_NAME, composite_plain)
                project.plain_lyrics = composite_plain
        project.source = request.source
        project.lrclib_id = request.lrclib_id
        write_project(self.projects_root, project)
        return project

    def save_editor(self, project_id: str, request: SaveEditorRequest) -> ProjectModel:
        synced = request.synced_lyrics or ""
        project = self._write_lyrics(project_id, synced, metadata=request.metadata)
        if request.plain_lyrics:
            plain = plain_for_timing(request.plain_lyrics, synced)
            if plain != project.plain_lyrics:
                write_text(self.projects_root, project_id, PLAIN_NAME, plain)
                project.plain_lyrics = plain
        return project

    def write_pyroller_result(self, project_id: str, synced: str) -> ProjectModel:
        project = self.get(project_id)
        # Keep the raw engine output for debugging/reproducibility, but write a
        # metadata-preserving version back to the project/editor. py-roller may
        # output only its own header (for example [by: py-roller]); users expect
        # existing [ti:], [ar:], [al:], [length:], etc. at the top of the editor
        # to survive an automatic timing pass.
        merged_synced = merge_lrc_metadata_header(project.synced_lyrics, synced)
        plain = derive_plain_from_synced(merged_synced)
        write_text(self.projects_root, project_id, PYROLLER_NAME, synced)
        write_text(self.projects_root, project_id, SYNCED_NAME, merged_synced)
        write_text(self.projects_root, project_id, PLAIN_NAME, plain)
        project.synced_lyrics = merged_synced
        project.plain_lyrics = plain
        project.source = "automatic timing"
        write_project(self.projects_root, project)
        return project

    def plain_lyrics_for_timing(self, project_id: str) -> str:
        project = self.get(project_id)
        return plain_for_timing(project.plain_lyrics, project.synced_lyrics)



    def delete_project(self, project_id: str) -> None:
        folder = self.project_folder(project_id)
        if folder.exists():
            shutil.rmtree(folder)

    def project_folder(self, project_id: str) -> Path:
        # Validate project first, then return the on-disk directory used by this project.
        self.get(project_id)
        return self.projects_root / project_id

    def _read_audio_meta(self, audio_path: Path) -> MetaModel:
        fallback_track = audio_path.stem.strip()
        try:
            from pylrclib.models import TrackMeta

            meta = TrackMeta.from_audio_file(audio_path)
            if meta:
                return MetaModel(
                    track=meta.track.strip() or fallback_track,
                    artist=meta.artist.strip(),
                    album=meta.album.strip(),
                    duration=meta.duration,
                )
        except Exception:
            pass
        # Fallback duration with mutagen, even if tags are incomplete.
        try:
            from mutagen import File as MutaFile

            audio = MutaFile(audio_path)
            duration = int(round(getattr(getattr(audio, "info", None), "length", 0) or 0)) if audio else 0
        except Exception:
            duration = 0
        return MetaModel(track=fallback_track, duration=duration)
