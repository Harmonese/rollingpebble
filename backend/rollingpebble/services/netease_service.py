from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from rollingpebble.models import NeteaseResolveResponse, NeteaseSearchResponse, NeteaseSongModel, NeteaseSongSearchRequest

NETEASE_SEARCH_URLS = (
    "https://music.163.com/api/search/get/web",
    "https://music.163.com/api/cloudsearch/pc",
)
NETEASE_DETAIL_URL = "https://music.163.com/api/song/detail"
NETEASE_PLAYER_URL = "https://music.163.com/api/song/enhance/player/url"
NETEASE_REFERER = "https://music.163.com/"
NETEASE_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def extract_netease_song_id(value: str) -> int | None:
    """Extract a NetEase Cloud Music song id from common web/wiki/share URLs."""
    text = (value or "").strip()
    if not text:
        return None
    for pattern in (
        r"(?:[?&#]|^)id=(\d{4,})",
        r"(?:[?&#]|^)songId=(\d{4,})",
        r"/song/(?:media/outer/url)?[^0-9]*(\d{4,})",
        r"/wiki/song[^0-9]*(\d{4,})",
    ):
        match = re.search(pattern, text)
        if match:
            return int(match.group(1))
    match = re.search(r"\b(\d{4,})\b", text)
    return int(match.group(1)) if match else None


def netease_song_url(song_id: int) -> str:
    return f"https://music.163.com/#/song?id={song_id}"


def netease_wiki_url(song_id: int) -> str:
    return f"https://music.163.com/#/wiki/song?songId={song_id}"


def netease_outer_audio_url(song_id: int) -> str:
    return f"https://music.163.com/song/media/outer/url?id={song_id}.mp3"


def netease_playback_url(song_id: int) -> str:
    return f"/api/netease/audio/{song_id}"


def netease_player_api_url(song_id: int, *, br: int = 320000) -> str:
    params = urlencode({"id": song_id, "ids": json.dumps([song_id]), "br": br})
    return f"{NETEASE_PLAYER_URL}?{params}"


def _player_audio_url_from_payload(payload: dict[str, Any], song_id: int) -> str | None:
    data = payload.get("data")
    if not isinstance(data, list):
        return None
    for item in data:
        if not isinstance(item, dict):
            continue
        try:
            item_id = int(item.get("id") or 0)
        except Exception:
            item_id = 0
        if item_id and item_id != song_id:
            continue
        url = item.get("url")
        code = item.get("code")
        if isinstance(url, str) and url.strip() and (code in (None, 200, "200")):
            return url.strip()
    return None


@dataclass(frozen=True)
class _RawSong:
    song_id: int
    name: str = ""
    artists: str = ""
    album: str = ""
    duration: int = 0


def _request_json(url: str, *, timeout: float = 12.0) -> dict[str, Any]:
    request = Request(
        url,
        headers={
            "Accept": "application/json,text/plain,*/*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Cookie": "os=pc; appver=2.9.7;",
            "Referer": NETEASE_REFERER,
            "User-Agent": NETEASE_USER_AGENT,
        },
    )
    with urlopen(request, timeout=timeout) as response:  # noqa: S310 - fixed HTTPS endpoint.
        raw = response.read().decode("utf-8", errors="replace")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise RuntimeError("NetEase returned an unexpected response.")
    return payload


def _artist_names(value: Any) -> str:
    if not isinstance(value, list):
        return ""
    names = []
    for item in value:
        if isinstance(item, dict) and item.get("name"):
            names.append(str(item["name"]))
    return " / ".join(names)


def _song_list_from_payload(payload: dict[str, Any]) -> list[Any]:
    """Return a defensive song list from known NetEase search payload shapes."""
    result = payload.get("result")
    if isinstance(result, dict):
        songs = result.get("songs")
        return songs if isinstance(songs, list) else []
    songs = payload.get("songs")
    return songs if isinstance(songs, list) else []


def _raw_song_from_search(item: dict[str, Any]) -> _RawSong | None:
    try:
        song_id = int(item.get("id") or 0)
    except Exception:
        song_id = 0
    if song_id <= 0:
        return None
    duration_ms = item.get("duration") or item.get("dt") or 0
    try:
        duration = int(round(float(duration_ms) / 1000)) if duration_ms else 0
    except Exception:
        duration = 0
    album_value = item.get("album") if isinstance(item.get("album"), dict) else item.get("al")
    if not isinstance(album_value, dict):
        album_value = {}
    artists = item.get("artists") if isinstance(item.get("artists"), list) else item.get("ar")
    return _RawSong(
        song_id=song_id,
        name=str(item.get("name") or ""),
        artists=_artist_names(artists),
        album=str(album_value.get("name") or ""),
        duration=duration,
    )


def _raw_song_from_detail(item: dict[str, Any]) -> _RawSong | None:
    try:
        song_id = int(item.get("id") or 0)
    except Exception:
        song_id = 0
    if song_id <= 0:
        return None
    duration_ms = item.get("dt") or item.get("duration") or 0
    try:
        duration = int(round(float(duration_ms) / 1000)) if duration_ms else 0
    except Exception:
        duration = 0
    album_value = item.get("al") if isinstance(item.get("al"), dict) else item.get("album")
    if not isinstance(album_value, dict):
        album_value = {}
    artists = item.get("ar") if isinstance(item.get("ar"), list) else item.get("artists")
    return _RawSong(
        song_id=song_id,
        name=str(item.get("name") or ""),
        artists=_artist_names(artists),
        album=str(album_value.get("name") or ""),
        duration=duration,
    )


def _model_from_raw(song: _RawSong) -> NeteaseSongModel:
    label_bits = [song.artists, song.name]
    label = " - ".join(part for part in label_bits if part) or str(song.song_id)
    if song.album:
        label = f"{label} · {song.album}"
    return NeteaseSongModel(
        id=song.song_id,
        name=song.name,
        artists=song.artists,
        album=song.album,
        duration=song.duration,
        label=label,
        song_url=netease_song_url(song.song_id),
        wiki_url=netease_wiki_url(song.song_id),
        outer_audio_url=netease_outer_audio_url(song.song_id),
        playback_url=netease_playback_url(song.song_id),
    )


def _dedupe_models(models: list[NeteaseSongModel], *, limit: int) -> list[NeteaseSongModel]:
    seen: set[int] = set()
    deduped: list[NeteaseSongModel] = []
    for model in models:
        if model.id in seen:
            continue
        seen.add(model.id)
        deduped.append(model)
        if len(deduped) >= limit:
            break
    return deduped


def _candidate_queries(request: NeteaseSongSearchRequest) -> list[str]:
    raw = [
        (request.query or "").strip(),
        " ".join(part for part in [request.track, request.artist] if part).strip(),
        " ".join(part for part in [request.track, request.artist, request.album] if part).strip(),
        " ".join(part for part in [request.artist, request.track] if part).strip(),
        (request.track or "").strip(),
    ]
    queries: list[str] = []
    for query in raw:
        if not query or query in queries:
            continue
        queries.append(query)
    return queries


class NeteaseService:
    def _search_query(self, query: str, *, limit: int) -> list[NeteaseSongModel]:
        models: list[NeteaseSongModel] = []
        last_error: Exception | None = None
        got_response = False
        for search_url in NETEASE_SEARCH_URLS:
            params = urlencode(
                {
                    "csrf_token": "",
                    "hlpretag": "",
                    "hlposttag": "",
                    "s": query,
                    "type": 1,
                    "offset": 0,
                    "total": "true",
                    "limit": limit,
                }
            )
            try:
                payload = _request_json(f"{search_url}?{params}")
            except Exception as exc:
                last_error = exc
                continue
            got_response = True
            songs = _song_list_from_payload(payload)
            for item in songs:
                if not isinstance(item, dict):
                    continue
                raw = _raw_song_from_search(item)
                if raw is not None:
                    models.append(_model_from_raw(raw))
            if models:
                break
        if last_error is not None and not models and not got_response:
            raise last_error
        return _dedupe_models(models, limit=limit)

    def search(self, request: NeteaseSongSearchRequest) -> NeteaseSearchResponse:
        limit = max(1, min(int(request.limit or 10), 50))
        all_models: list[NeteaseSongModel] = []
        queries = _candidate_queries(request)
        if not queries:
            return NeteaseSearchResponse(results=[])
        last_error: Exception | None = None
        for query in queries:
            try:
                all_models.extend(self._search_query(query, limit=limit))
                last_error = None
            except Exception as exc:
                last_error = exc
                continue
            if all_models:
                break
        if last_error is not None and not all_models:
            raise last_error
        return NeteaseSearchResponse(results=_dedupe_models(all_models, limit=limit))


    def resolve_audio_url(self, song_id: int) -> str | None:
        """Resolve NetEase's current playable CDN URL when the public API provides one."""
        if song_id <= 0:
            return None
        try:
            payload = _request_json(netease_player_api_url(song_id))
        except Exception:
            return None
        return _player_audio_url_from_payload(payload, song_id)

    def open_audio(self, song_id: int, *, range_header: str | None = None, timeout: float = 20.0):
        if song_id <= 0:
            raise ValueError("Invalid NetEase song ID.")
        headers = {
            "Accept": "audio/*,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Cookie": "os=pc; appver=2.9.7;",
            "Referer": NETEASE_REFERER,
            "User-Agent": NETEASE_USER_AGENT,
        }
        if range_header and range_header.strip().lower().startswith("bytes="):
            headers["Range"] = range_header.strip()

        candidates: list[str] = []
        resolved_url = self.resolve_audio_url(song_id)
        if resolved_url:
            candidates.append(resolved_url)
        candidates.append(netease_outer_audio_url(song_id))

        last_error: Exception | None = None
        for url in candidates:
            request = Request(url, headers=headers)
            try:
                upstream = urlopen(request, timeout=timeout)  # noqa: S310 - fixed NetEase media endpoint.
            except (HTTPError, URLError) as exc:
                last_error = exc
                continue
            content_type = (upstream.headers.get_content_type() or "").lower()
            if content_type and not (content_type.startswith("audio/") or content_type == "application/octet-stream"):
                upstream.close()
                last_error = RuntimeError(f"NetEase returned non-audio content: {content_type}")
                continue
            return upstream

        if isinstance(last_error, HTTPError):
            raise last_error
        if last_error is not None:
            raise RuntimeError(f"Could not open NetEase audio stream: {last_error}") from last_error
        raise RuntimeError("Could not open NetEase audio stream.")

    def resolve(self, value: str) -> NeteaseResolveResponse:
        song_id = extract_netease_song_id(value)
        if song_id is None:
            raise ValueError("Could not find a NetEase song ID in the provided value.")
        model: NeteaseSongModel | None = None
        try:
            params = urlencode({"ids": json.dumps([song_id])})
            payload = _request_json(f"{NETEASE_DETAIL_URL}?{params}")
            songs = payload.get("songs", [])
            if isinstance(songs, list) and songs and isinstance(songs[0], dict):
                raw = _raw_song_from_detail(songs[0])
                if raw is not None:
                    model = _model_from_raw(raw)
        except Exception:
            model = None
        if model is None:
            model = _model_from_raw(_RawSong(song_id=song_id))
        return NeteaseResolveResponse(song=model)

    def fetch_lyrics(self, song_id: int) -> NeteaseLyricResponse:
        from rollingpebble.models import NeteaseLyricResponse

        url = f"https://music.163.com/api/song/lyric?id={song_id}&lv=1&kv=1&tv=-1"
        data = _request_json(url, timeout=10.0)
        lrc_obj = data.get("lrc") if isinstance(data.get("lrc"), dict) else {}
        tlyric_obj = data.get("tlyric") if isinstance(data.get("tlyric"), dict) else {}
        return NeteaseLyricResponse(
            lyric=lrc_obj.get("lyric") if isinstance(lrc_obj.get("lyric"), str) and lrc_obj.get("lyric") else None,
            tlyric=tlyric_obj.get("lyric") if isinstance(tlyric_obj.get("lyric"), str) and tlyric_obj.get("lyric") else None,
        )
