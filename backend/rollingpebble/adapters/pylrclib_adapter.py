from __future__ import annotations

import importlib.metadata
from dataclasses import dataclass
from typing import Any

from rollingpebble.version import app_version
from rollingpebble.models import (
    LrclibGetResponse,
    LrclibSearchResponse,
    LyricsRecordModel,
    MetaModel,
    UploadPlanResponse,
)


def _common_options():
    from pylrclib.config import CommonOptions, LRCLIB_BASE, MAX_HTTP_RETRIES_DEFAULT, PREVIEW_LINES_DEFAULT

    return CommonOptions(
        lang="en",
        preview_lines=PREVIEW_LINES_DEFAULT,
        max_http_retries=MAX_HTTP_RETRIES_DEFAULT,
        user_agent=f"rollingpebble/{app_version()} pylrclib/embedded",
        lrclib_base=LRCLIB_BASE,
        interactive=False,
        assume_yes=True,
    )


def _track_meta(meta: MetaModel):
    from pylrclib.models import TrackMeta

    return TrackMeta(
        path=None,
        track=meta.track.strip(),
        artist=meta.artist.strip(),
        album=meta.album.strip(),
        duration=int(meta.duration or 0),
    )


def dependency_status() -> tuple[bool, str | None, str | None]:
    try:
        import pylrclib  # noqa: F401
    except Exception as exc:  # pragma: no cover - env dependent
        return False, None, str(exc)
    version = getattr(pylrclib, "__version__", None)
    try:
        package_version = importlib.metadata.version("pylrclib-cli")
        if version and version != package_version:
            version = f"module {version}, package {package_version}"
        else:
            version = package_version or version
    except importlib.metadata.PackageNotFoundError:
        pass
    return True, version, None


def _record_model(record: Any) -> LyricsRecordModel:
    return LyricsRecordModel(
        id=record.lrclib_id,
        track_name=record.track_name,
        artist_name=record.artist_name,
        album_name=record.album_name,
        duration=record.duration,
        plain_lyrics=record.plain,
        synced_lyrics=record.synced,
        instrumental=record.instrumental,
        has_plain=bool(record.plain.strip()),
        has_synced=bool(record.synced.strip()),
        label=record.label,
    )


@dataclass(slots=True)
class PylrclibAdapter:
    def _client(self):
        from pylrclib.api import ApiClient

        return ApiClient(_common_options())

    def search(
        self,
        *,
        query: str | None,
        track_name: str | None,
        artist_name: str | None,
        album_name: str | None,
        limit: int,
    ) -> LrclibSearchResponse:
        client = self._client()
        records = client.search(
            query=query or None,
            track_name=track_name or None,
            artist_name=artist_name or None,
            album_name=album_name or None,
        )
        return LrclibSearchResponse(results=[_record_model(record) for record in records[: max(1, limit)]])

    def get_cached_then_external(self, meta: MetaModel) -> LrclibGetResponse:
        client = self._client()
        track = _track_meta(meta)
        result = client.get_cached(track)
        if not result.record:
            result = client.get_external(track)
        return LrclibGetResponse(
            record=_record_model(result.record) if result.record else None,
            duration_diff=result.duration_diff,
            duration_ok=result.duration_ok,
            source=result.source,
        )

    def get_external(self, meta: MetaModel) -> LrclibGetResponse:
        client = self._client()
        result = client.get_external(_track_meta(meta))
        return LrclibGetResponse(
            record=_record_model(result.record) if result.record else None,
            duration_diff=result.duration_diff,
            duration_ok=result.duration_ok,
            source=result.source,
        )

    def cleanse_lrc_text(self, text: str, *, remove_translations: bool = True) -> dict[str, Any]:
        from pylrclib.lrc import parse_lrc_text

        parsed = parse_lrc_text(text, remove_translations=remove_translations)
        if not parsed.has_valid_timestamps:
            return {
                "status": "invalid",
                "cleaned_text": None,
                "plain_lyrics": parsed.plain or "",
                "is_instrumental": parsed.is_instrumental,
                "has_valid_timestamps": False,
                "warnings": parsed.warnings,
                "reason": "no_valid_timestamps",
            }
        cleaned = parsed.synced
        status = "unchanged" if cleaned == text else "updated"
        if text.strip() and not cleaned.strip() and not parsed.is_instrumental:
            return {
                "status": "invalid",
                "cleaned_text": None,
                "plain_lyrics": parsed.plain or "",
                "is_instrumental": parsed.is_instrumental,
                "has_valid_timestamps": True,
                "warnings": parsed.warnings,
                "reason": "empty_after_cleanse",
            }
        return {
            "status": status,
            "cleaned_text": cleaned,
            "plain_lyrics": parsed.plain or "",
            "is_instrumental": parsed.is_instrumental,
            "has_valid_timestamps": parsed.has_valid_timestamps,
            "warnings": parsed.warnings,
            "reason": None,
        }

    def get_by_id(self, lrclib_id: int) -> LyricsRecordModel | None:
        client = self._client()
        record = client.get_by_id(lrclib_id)
        return _record_model(record) if record else None

    def build_upload_plan(
        self,
        *,
        meta: MetaModel,
        plain: str,
        synced: str,
        mode: str,
        allow_derived_plain: bool,
    ) -> UploadPlanResponse:
        from pylrclib.models import LyricsBundle
        from pylrclib.workflows.up import build_upload_plan

        instrumental = mode == "instrumental"
        bundle_kind = "instrumental" if instrumental else "mixed" if plain and synced else "synced" if synced else "plain" if plain else "empty"
        bundle = LyricsBundle(
            kind=bundle_kind,
            plain=plain or "",
            synced=synced or "",
            instrumental=instrumental,
            warnings=[],
        )
        plan = build_upload_plan(bundle, mode=mode, allow_derived_plain=allow_derived_plain)
        warnings: list[str] = []
        if not meta.track.strip():
            warnings.append("missing_track")
        if not meta.artist.strip():
            warnings.append("missing_artist")
        if not meta.duration:
            warnings.append("missing_duration")
        if plan.mode == "lyrics" and not ((plan.plain or "").strip() or (plan.synced or "").strip()):
            warnings.append("empty_lyrics")
        can_upload = plan.mode in {"lyrics", "instrumental"} and not any(w.startswith("missing_") for w in warnings)
        payload_preview: dict[str, Any] = {
            "trackName": meta.track,
            "artistName": meta.artist,
            "albumName": meta.album,
            "duration": meta.duration,
        }
        if plan.mode == "lyrics":
            payload_preview.update(
                {
                    "plainLyrics": bool((plan.plain or "").strip()),
                    "syncedLyrics": bool((plan.synced or "").strip()),
                }
            )
        return UploadPlanResponse(
            can_upload=can_upload,
            mode=plan.mode,
            reason=plan.reason,
            plain_lines=len((plan.plain or "").splitlines()) if plan.plain else 0,
            synced_lines=len((plan.synced or "").splitlines()) if plan.synced else 0,
            warnings=warnings,
            payload_preview=payload_preview,
        )

    def upload(
        self,
        *,
        meta: MetaModel,
        plain: str,
        synced: str,
        mode: str,
        allow_derived_plain: bool,
    ) -> tuple[bool, str]:
        plan = self.build_upload_plan(
            meta=meta,
            plain=plain,
            synced=synced,
            mode=mode,
            allow_derived_plain=allow_derived_plain,
        )
        if not plan.can_upload:
            return False, f"Upload skipped: {plan.reason}; warnings={','.join(plan.warnings)}"

        client = self._client()
        track = _track_meta(meta)
        if plan.mode == "instrumental":
            ok = client.upload_instrumental(track)
            return ok, "instrumental uploaded" if ok else "instrumental upload failed"

        # Recompute through pylrclib so synced-only/derived-plain semantics stay aligned.
        from pylrclib.models import LyricsBundle
        from pylrclib.workflows.up import build_upload_plan

        bundle = LyricsBundle(kind="mixed" if plain and synced else "synced" if synced else "plain", plain=plain, synced=synced)
        pylrc_plan = build_upload_plan(bundle, mode=mode, allow_derived_plain=allow_derived_plain)
        ok = client.upload_lyrics(track, pylrc_plan.plain or "", pylrc_plan.synced or "")
        return ok, "lyrics uploaded" if ok else "lyrics upload failed"
