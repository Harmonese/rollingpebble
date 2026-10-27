import asyncio
import json
import sys
import uuid
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from rollingpebble.config import Settings
from rollingpebble.main import create_app
from rollingpebble.messages import AppError
from rollingpebble.models import RuntimeSettingsModel
from rollingpebble.translation import (
    ConnectionUpdate, Credentials, TranslationRequest, TranslationService, parse_result, validate_url, PROMPT, OUTPUT_RULES,
)


def test_custom_prompt_snapshot_and_defaults():
    seen = []
    def handler(req):
        seen.append(json.loads(req.content)["messages"][0]["content"])
        return response('{"lines":[{"id":"a","text":"甲"},{"id":"b","text":"乙"}]}')
    async def run():
        svc = service(handler)
        assert svc.report()["prompt"] == svc.report()["default_prompt"] == PROMPT
        svc.configure(ConnectionUpdate(base_url="http://localhost:11434/v1", model="local", prompt="Use concise language."))
        first = svc.start(request())
        svc.configure(ConnectionUpdate(base_url="http://localhost:11434/v1", model="local", prompt="Use formal language."))
        await svc.tasks[first["id"]]
        assert seen == ["Use concise language.\n\n" + OUTPUT_RULES]
        assert first["status"] == "succeeded"
        second = svc.start(request())
        await svc.tasks[second["id"]]
        assert seen[1] == "Use formal language.\n\n" + OUTPUT_RULES
        svc.configure(ConnectionUpdate(base_url="http://localhost:11434/v1", model="local", prompt="  "))
        assert svc.report()["prompt"] == PROMPT
    asyncio.run(run())


def request(**values):
    return TranslationRequest(request_id=uuid.uuid4(), workspace_id="workspace", revision="one",
        target_language="zh-CN", lines=[{"id": "a", "text": "One"}, {"id": "b", "text": "One"}],
        title="Song", artist="Singer", **values)


def service(handler):
    settings = RuntimeSettingsModel(translation_connection={"base_url": "http://localhost:11434/v1", "model": "local"})
    runtime = SimpleNamespace(get_settings=lambda: settings, settings=SimpleNamespace(write=lambda value: None))
    credentials = Credentials()
    credentials.memory[settings.translation_connection["base_url"]] = "private-key"
    return TranslationService(runtime, credentials, httpx.MockTransport(handler))


def response(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}]})


def test_context_ids_single_and_no_extension_requirements(monkeypatch):
    monkeypatch.setenv("HTTPS_PROXY", "http://invalid:1")
    seen = []
    def handler(req):
        assert str(req.url) == "http://localhost:11434/v1/chat/completions"
        assert req.headers["authorization"] == "Bearer private-key"
        body = json.loads(req.content)
        assert set(body) == {"model", "messages", "stream"}
        context = json.loads(body["messages"][1]["content"])
        seen.append(context)
        return response(json.dumps({"lines": [{"id": ident, "text": "译文"} for ident in reversed(context["requested_ids"])]}))
    async def run():
        svc = service(handler)
        first = request()
        job = svc.start(first)
        assert svc.start(first) is job
        await svc.tasks[job["id"]]
        assert job["status"] == "succeeded"
        assert [line["id"] for line in job["result"]] == ["a", "b"]
        single = svc.start(request(selected_ids=["b"]))
        await svc.tasks[single["id"]]
        assert single["result"] == [{"id": "b", "text": "译文"}]
        assert len(seen[1]["lines"]) == 2
        assert seen[1]["title"] == "Song" and seen[1]["artist"] == "Singer"
        assert "workspace_id" not in seen[1] and "revision" not in seen[1]
    asyncio.run(run())


@pytest.mark.parametrize("bad", [
    '{"lines":[]}', '{"lines":[{"id":"a","text":"x"},{"id":"a","text":"y"}]}',
    '{"lines":[{"id":"a","text":7}]}', 'Here is {"lines":[]}', '{"lines":[',
])
def test_strict_format_repair_once(bad):
    calls = []
    def handler(req):
        calls.append(json.loads(req.content))
        return response(bad)
    async def run():
        svc = service(handler)
        job = svc.start(request())
        await svc.tasks[job["id"]]
        assert job["status"] == "failed" and job["error"] == "translation.format"
        assert job["result"] is None and len(calls) == 2
        assert len(calls[1]["messages"]) == 4
    asyncio.run(run())


def test_fenced_json_and_reordered_response():
    assert parse_result('```json\n{"lines":[{"id":"b","text":"乙"},{"id":"a","text":"甲"}]}\n```', ["a", "b"]) == [
        {"id": "a", "text": "甲"}, {"id": "b", "text": "乙"}]


@pytest.mark.parametrize("status,code", [(401, "auth"), (429, "rate"), (400, "request"), (302, "network")])
def test_errors_not_retried_or_exposed(status, code):
    calls = []
    def handler(req):
        calls.append(req)
        return httpx.Response(status, headers={"location": "https://other.example"}, text="private-key private lyrics")
    async def run():
        svc = service(handler)
        job = svc.start(request())
        await svc.tasks[job["id"]]
        assert job["error"] == "translation." + code and len(calls) == 1
        assert "private" not in json.dumps(job)
    asyncio.run(run())


def test_cancellation_waits_for_http_close_and_deduplicates():
    async def run():
        entered, closing, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
        async def handler(req):
            entered.set()
            try:
                await asyncio.Future()
            finally:
                closing.set()
                await release.wait()
        svc = service(handler)
        first = request()
        job = svc.start(first)
        await entered.wait()
        cancel = asyncio.create_task(svc.cancel(job["id"]))
        await closing.wait()
        assert job["status"] == "cancelling" and not cancel.done()
        with pytest.raises(AppError):
            svc.start(request())
        assert svc.start(first) is job
        release.set()
        await cancel
        assert job["status"] == "canceled" and job["result"] is None
        await svc.close()
    asyncio.run(run())


def test_key_binding_and_session_fallback(monkeypatch):
    stored = {}
    keyring = SimpleNamespace(get_password=lambda _, key: stored.get(key),
        set_password=lambda _, key, value: stored.update({key: value}),
        delete_password=lambda _, key: stored.pop(key))
    monkeypatch.setitem(sys.modules, "keyring", keyring)
    svc = service(lambda req: response("OK"))
    report = svc.configure(ConnectionUpdate(base_url="https://one.example/v1", model="model", api_key="secret"))
    assert report["has_key"] and "secret" not in json.dumps(report)
    svc.configure(ConnectionUpdate(base_url="https://two.example/v1", model="model"))
    assert not svc.report()["has_key"]
    def unavailable(*args):
        raise RuntimeError("No keychain")
    keyring.set_password = unavailable
    svc.configure(ConnectionUpdate(base_url="https://two.example/v1", model="model", api_key="session"))
    assert not svc.report()["key_persistent"] and svc.report()["has_key"]
    assert "api_key" not in svc.runtime.get_settings().translation_connection


@pytest.mark.parametrize("url", ["http://remote.example/v1", "file:///tmp/key", "https://user:secret@example.org", "http://localhost:bad/v1"])
def test_invalid_connections(url):
    with pytest.raises(AppError):
        validate_url(url)


@pytest.mark.parametrize("newline", ["\n", "\r\n", "\r"])
def test_origin_and_structured_project_roundtrip(tmp_path, newline):
    with TestClient(create_app(Settings(data_dir=tmp_path)), base_url="http://127.0.0.1") as client:
        url = "/api/translation/connection"
        body = {"base_url": "http://localhost:11434/v1", "model": "local", "prompt": "Preserve metaphors."}
        assert client.put(url, json=body).status_code == 403
        headers = {"x-rollingpebble-client": "translation", "origin": "https://malicious.example"}
        assert client.put(url, json=body, headers=headers).status_code == 403
        headers["origin"] = "http://127.0.0.1"
        assert client.put(url, json=body, headers=headers).status_code == 200
        assert client.get(url).json()["prompt"] == body["prompt"]
        from rollingpebble.storage.app_settings import SettingsStore
        reopened = TranslationService(SimpleNamespace(get_settings=SettingsStore(tmp_path).read))
        assert reopened.connection().prompt == body["prompt"]
        assert client.get("/api/projects").json() == []
        source = newline.join(["[00:01.00]One", "[00:02.00]Two"])
        doc = {"version": 1, "source_lrc": source, "target_language": "zh-CN", "lines": [
            {"id": "stable", "text": "One", "time": 1, "translation": "一", "source_text": "One"},
            {"id": "second", "text": "Two", "time": 2, "translation": "二", "source_text": "Two"}]}
        saved = client.put(f"/api/projects/drafts/{uuid.uuid4()}", data={"snapshot": json.dumps({
            "synced_lyrics": source, "lyric_document": doc})}, files={"audio": ("song.wav", b"test")})
        assert saved.status_code == 200, saved.text
        ident = saved.json()["project_id"]
        assert saved.json()["lyric_document"] == doc
        loaded = client.get(f"/api/projects/{ident}").json()
        assert loaded["lyric_document"] == doc
        assert client.get(f"/api/projects/{ident}").json()["lyric_document"] == doc
        doc["lines"][0]["translation"] = "第一句"
        updated = client.post(f"/api/projects/{ident}/lyrics", json={
            "synced_lyrics": source, "lyric_document": doc})
        assert updated.status_code == 200, updated.text
        assert client.get(f"/api/projects/{ident}").json()["lyric_document"] == doc
        # An external LRC edit must never rebind an old translation by position.
        from pathlib import Path
        from rollingpebble.storage.files import SYNCED_NAME
        (Path(loaded["audio_path"]).parent / SYNCED_NAME).write_text("[00:01.00]Other", encoding="utf-8")
        assert client.get(f"/api/projects/{ident}").json()["lyric_document"] is None
        # Reading an inconsistent project must not destroy the stored document.
        stored = json.loads((Path(loaded["audio_path"]).parent / "project.json").read_text())
        assert stored["lyric_document"] == doc
        (Path(loaded["audio_path"]).parent / SYNCED_NAME).write_text(source, encoding="utf-8", newline="")
    # A fresh application session restores the same IDs and translations.
    with TestClient(create_app(Settings(data_dir=tmp_path)), base_url="http://127.0.0.1") as reopened:
        assert reopened.get(f"/api/projects/{ident}").json()["lyric_document"] == doc
