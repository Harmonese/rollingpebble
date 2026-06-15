from __future__ import annotations

from fastapi import APIRouter, Header
from fastapi.responses import StreamingResponse

from rollingpebble.api.context import AppServices, service_call
from rollingpebble.models import (
    LrclibGetRequest,
    LrclibGetResponse,
    LrclibIdRequest,
    LrclibSearchRequest,
    LrclibSearchResponse,
    LyricsRecordModel,
    NeteaseLyricResponse,
    NeteaseResolveRequest,
    NeteaseResolveResponse,
    NeteaseSearchResponse,
    NeteaseSongSearchRequest,
)


def create_lyrics_sources_router(services: AppServices) -> APIRouter:
    router = APIRouter()

    @router.post("/api/lrclib/search", response_model=LrclibSearchResponse)
    def lrclib_search(request: LrclibSearchRequest) -> LrclibSearchResponse:
        return service_call(lambda: services.lrclib.search(request))

    @router.post("/api/lrclib/get", response_model=LrclibGetResponse)
    def lrclib_get(request: LrclibGetRequest) -> LrclibGetResponse:
        return service_call(lambda: services.lrclib.get_cached_then_external(request))

    @router.post("/api/lrclib/id", response_model=LyricsRecordModel | None)
    def lrclib_get_by_id(request: LrclibIdRequest) -> LyricsRecordModel | None:
        return service_call(lambda: services.lrclib.get_by_id(request))

    @router.post("/api/netease/search", response_model=NeteaseSearchResponse)
    def netease_search(request: NeteaseSongSearchRequest) -> NeteaseSearchResponse:
        return service_call(lambda: services.netease.search(request))

    @router.post("/api/netease/resolve", response_model=NeteaseResolveResponse)
    def netease_resolve(request: NeteaseResolveRequest) -> NeteaseResolveResponse:
        return service_call(lambda: services.netease.resolve(request.value))

    @router.get("/api/netease/lyrics/{song_id}", response_model=NeteaseLyricResponse)
    def netease_lyrics(song_id: int) -> NeteaseLyricResponse:
        return service_call(lambda: services.netease.fetch_lyrics(song_id))

    @router.get("/api/netease/audio/{song_id}")
    def netease_audio(song_id: int, range: str | None = Header(default=None)) -> StreamingResponse:
        upstream = service_call(lambda: services.netease.open_audio(song_id, range_header=range))

        def stream_audio():
            try:
                while True:
                    chunk = upstream.read(1024 * 256)
                    if not chunk:
                        break
                    yield chunk
            finally:
                upstream.close()

        headers: dict[str, str] = {}
        for source, target in (
            ("Content-Length", "Content-Length"),
            ("Content-Range", "Content-Range"),
            ("Accept-Ranges", "Accept-Ranges"),
        ):
            value = upstream.headers.get(source)
            if value:
                headers[target] = value
        media_type = upstream.headers.get_content_type() or "audio/mpeg"
        return StreamingResponse(
            stream_audio(),
            status_code=getattr(upstream, "status", 200),
            media_type=media_type,
            headers=headers,
        )

    return router
