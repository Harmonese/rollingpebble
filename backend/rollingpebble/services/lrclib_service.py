from __future__ import annotations

from rollingpebble.adapters.pylrclib_adapter import PylrclibAdapter
from rollingpebble.models import LrcCleanseRequest, LrcCleanseResponse, LrclibGetRequest, LrclibGetResponse, LrclibIdRequest, LrclibSearchRequest, LrclibSearchResponse, LyricsRecordModel, MetaModel


class LrclibService:
    def __init__(self, adapter: PylrclibAdapter | None = None) -> None:
        self.adapter = adapter or PylrclibAdapter()

    def search(self, request: LrclibSearchRequest) -> LrclibSearchResponse:
        return self.adapter.search(
            query=request.query,
            track_name=request.track or request.title,
            artist_name=request.artist,
            album_name=request.album,
            limit=request.limit,
        )

    def get_cached_then_external(self, request: LrclibGetRequest) -> LrclibGetResponse:
        return self.adapter.get_cached_then_external(
            MetaModel(track=request.track, artist=request.artist, album=request.album, duration=request.duration)
        )

    def get_by_id(self, request: LrclibIdRequest) -> LyricsRecordModel | None:
        return self.adapter.get_by_id(request.lrclib_id)

    def cleanse_lrc_text(self, request: LrcCleanseRequest) -> LrcCleanseResponse:
        return LrcCleanseResponse(**self.adapter.cleanse_lrc_text(request.text, remove_translations=request.remove_translations))
