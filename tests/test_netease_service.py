from rollingpebble.services.netease_service import (
    extract_netease_song_id,
    netease_outer_audio_url,
    netease_wiki_url,
)


def test_extract_netease_song_id_from_song_and_wiki_urls() -> None:
    assert extract_netease_song_id("https://music.163.com/#/song?id=3350769226") == 3350769226
    assert extract_netease_song_id("https://music.163.com/#/wiki/song?songId=3350769226") == 3350769226


def test_netease_derived_urls() -> None:
    assert netease_wiki_url(3350769226) == "https://music.163.com/#/wiki/song?songId=3350769226"
    assert netease_outer_audio_url(3350769226) == "https://music.163.com/song/media/outer/url?id=3350769226.mp3"


def test_netease_search_tolerates_non_object_result(monkeypatch) -> None:
    from rollingpebble.models import NeteaseSongSearchRequest
    from rollingpebble.services import netease_service
    from rollingpebble.services.netease_service import NeteaseService

    def fake_request_json(url: str, *, timeout: float = 12.0) -> dict:
        return {"code": 200, "result": ""}

    monkeypatch.setattr(netease_service, "_request_json", fake_request_json)
    response = NeteaseService().search(NeteaseSongSearchRequest(query="test"))
    assert response.results == []


def test_netease_search_supports_modern_song_shape(monkeypatch) -> None:
    from rollingpebble.models import NeteaseSongSearchRequest
    from rollingpebble.services import netease_service
    from rollingpebble.services.netease_service import NeteaseService

    def fake_request_json(url: str, *, timeout: float = 12.0) -> dict:
        return {
            "code": 200,
            "result": {
                "songs": [
                    {
                        "id": 3350769226,
                        "name": "Track",
                        "ar": [{"name": "Artist"}],
                        "al": {"name": "Album"},
                        "dt": 123000,
                    }
                ]
            },
        }

    monkeypatch.setattr(netease_service, "_request_json", fake_request_json)
    response = NeteaseService().search(NeteaseSongSearchRequest(query="test"))
    assert len(response.results) == 1
    song = response.results[0]
    assert song.id == 3350769226
    assert song.artists == "Artist"
    assert song.album == "Album"
    assert song.duration == 123


def test_netease_search_uses_track_artist_fallback_when_query_is_empty(monkeypatch) -> None:
    from urllib.parse import parse_qs, urlparse

    from rollingpebble.models import NeteaseSongSearchRequest
    from rollingpebble.services import netease_service
    from rollingpebble.services.netease_service import NeteaseService

    seen_queries: list[str] = []

    def fake_request_json(url: str, *, timeout: float = 12.0) -> dict:
        query = parse_qs(urlparse(url).query).get("s", [""])[0]
        seen_queries.append(query)
        if query == "Track Artist":
            return {
                "code": 200,
                "result": {
                    "songs": [
                        {
                            "id": 3350769226,
                            "name": "Track",
                            "ar": [{"name": "Artist"}],
                            "al": {"name": "Album"},
                            "dt": 123000,
                        }
                    ]
                },
            }
        return {"code": 200, "result": {"songs": []}}

    monkeypatch.setattr(netease_service, "_request_json", fake_request_json)
    response = NeteaseService().search(NeteaseSongSearchRequest(track="Track", artist="Artist", limit=5))

    assert seen_queries[0] == "Track Artist"
    assert len(response.results) == 1
    assert response.results[0].id == 3350769226


def test_netease_search_tries_second_endpoint_after_empty_primary(monkeypatch) -> None:
    from rollingpebble.models import NeteaseSongSearchRequest
    from rollingpebble.services import netease_service
    from rollingpebble.services.netease_service import NeteaseService

    called_urls: list[str] = []

    def fake_request_json(url: str, *, timeout: float = 12.0) -> dict:
        called_urls.append(url)
        if "api/search/get/web" in url:
            return {"code": 200, "result": {"songs": []}}
        return {
            "code": 200,
            "result": {
                "songs": [
                    {
                        "id": 3350769226,
                        "name": "Track",
                        "ar": [{"name": "Artist"}],
                        "al": {"name": "Album"},
                        "dt": 123000,
                    }
                ]
            },
        }

    monkeypatch.setattr(netease_service, "_request_json", fake_request_json)
    response = NeteaseService().search(NeteaseSongSearchRequest(query="Track Artist", limit=5))

    assert any("api/search/get/web" in url for url in called_urls)
    assert any("api/cloudsearch/pc" in url for url in called_urls)
    assert len(response.results) == 1


def test_netease_model_includes_same_origin_playback_url(monkeypatch) -> None:
    from rollingpebble.models import NeteaseSongSearchRequest
    from rollingpebble.services import netease_service
    from rollingpebble.services.netease_service import NeteaseService

    def fake_request_json(url: str, *, timeout: float = 12.0) -> dict:
        return {
            "code": 200,
            "result": {
                "songs": [
                    {
                        "id": 3350769226,
                        "name": "Track",
                        "ar": [{"name": "Artist"}],
                        "al": {"name": "Album"},
                        "dt": 123000,
                    }
                ]
            },
        }

    monkeypatch.setattr(netease_service, "_request_json", fake_request_json)
    song = NeteaseService().search(NeteaseSongSearchRequest(query="Track Artist")).results[0]

    assert song.outer_audio_url == "https://music.163.com/song/media/outer/url?id=3350769226.mp3"
    assert song.playback_url == "/api/netease/audio/3350769226"


def test_netease_player_api_url_extracts_playable_url() -> None:
    from rollingpebble.services.netease_service import _player_audio_url_from_payload, netease_player_api_url

    song_id = 3350769226
    url = netease_player_api_url(song_id)

    assert "api/song/enhance/player/url" in url
    assert "id=3350769226" in url
    assert _player_audio_url_from_payload(
        {"data": [{"id": song_id, "url": "https://m801.music.126.net/song.mp3", "code": 200}]},
        song_id,
    ) == "https://m801.music.126.net/song.mp3"


def test_netease_open_audio_prefers_player_api_url(monkeypatch) -> None:
    from rollingpebble.services import netease_service
    from rollingpebble.services.netease_service import NeteaseService

    opened: list[str] = []

    class FakeHeaders(dict):
        def get_content_type(self) -> str:
            return str(self.get("Content-Type", "audio/mpeg"))

    class FakeUpstream:
        status = 200
        headers = FakeHeaders({"Content-Type": "audio/mpeg"})

        def close(self) -> None:
            pass

    def fake_request_json(url: str, *, timeout: float = 12.0) -> dict:
        return {"data": [{"id": 3350769226, "url": "https://m801.music.126.net/song.mp3", "code": 200}]}

    def fake_urlopen(request, timeout: float = 20.0):
        opened.append(request.full_url)
        return FakeUpstream()

    monkeypatch.setattr(netease_service, "_request_json", fake_request_json)
    monkeypatch.setattr(netease_service, "urlopen", fake_urlopen)

    upstream = NeteaseService().open_audio(3350769226)

    assert upstream.status == 200
    assert opened == ["https://m801.music.126.net/song.mp3"]
