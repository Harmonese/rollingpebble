"""Host language boundaries and frozen task configuration; no neural inference."""
import hashlib
import json
from types import SimpleNamespace

import pytest

from rollingpebble.auto_timing.contracts import Options, RunRequest
from rollingpebble.auto_timing.languages import engine_options, required_models, resolve_language
from rollingpebble.auto_timing.protocol import EventStream, ProtocolError, plain_inventory
from rollingpebble.auto_timing.service import AutoTimingService
from rollingpebble.auto_timing.store import RunStore
from rollingpebble.models import RuntimeSettingsUpdateRequest
from rollingpebble.storage.app_settings import SettingsStore
from test_auto_timing_v2 import event, service_fixture


@pytest.mark.parametrize("language,kind,path", [
    ("en", "ctc", "/english"), ("zh", "ctc-zh", "/mandarin"),
    ("zh-en", "ctc-zh", "/mandarin"), ("mul", "ctc-mul", "/phoneme"),
])
def test_language_selects_only_its_ctc(language, kind, path):
    options = Options(ctc_model="/english", ctc_zh_model="/mandarin", ctc_mul_model="/phoneme").model_dump()
    resolved = engine_options(options, language)
    assert resolved["ctc_model"] == path
    assert "ctc_zh_model" not in resolved and "ctc_mul_model" not in resolved
    assert required_models(resolved) == ["whisper"]
    resolved.pop("ctc_model")
    assert required_models(resolved) == ["whisper", kind]
    resolved["audio_mode"] = "vocals"
    assert required_models(resolved)[-1] == "demucs"


def test_old_english_path_is_never_used_for_other_languages():
    options = Options(ctc_model="/old-english").model_dump()
    for language, kind in [("zh", "ctc-zh"), ("zh-en", "ctc-zh"), ("mul", "ctc-mul")]:
        resolved = engine_options(options, language)
        assert "ctc_model" not in resolved
        assert kind in required_models(resolved)


def test_engine_adapter_uses_stdin_and_rejects_failed_or_unknown_results(monkeypatch):
    def run(command, **kwargs):
        assert command[:2] == ["/managed/python", "-c"]
        assert "pyroller.language import resolve_language" in command[2]
        assert json.loads(kwargs["input"]) == ["你好\nПривет", "auto"]
        assert kwargs["env"] == {"HF_HUB_OFFLINE": "1"}
        return SimpleNamespace(returncode=0, stdout='"mul"')
    monkeypatch.setattr("rollingpebble.auto_timing.languages.subprocess.run", run)
    assert resolve_language("/managed/python", "你好\nПривет", "auto", {"HF_HUB_OFFLINE": "1"}) == "mul"
    monkeypatch.setattr("rollingpebble.auto_timing.languages.subprocess.run",
                        lambda *a, **k: SimpleNamespace(returncode=0, stdout='"unknown"'))
    with pytest.raises(ValueError):
        resolve_language("python", "lyrics", "auto", {})


def test_unicode_input_and_historical_defaults(tmp_path):
    original = "[ti:你好]\n[Chorus]\n[00:00.00]繁體歌詞\nПривет мир\nこんにちは\n繁體歌詞"
    assert plain_inventory(original) == "繁體歌詞\nПривет мир\nこんにちは\n繁體歌詞\n"
    store = SettingsStore(tmp_path)
    store.path.write_text(json.dumps({"auto_timing_v2_options": {"ctc_model": "/old"}}))
    options = store.read().auto_timing_v2_options
    assert options["language"] == "auto" and options["ctc_model"] == "/old"
    assert Options().language == "auto"
    assert RunStore.normalize({"kind": "run"})["language"] == "en"
    record = RunStore.normalize({"kind": "run", "options": {}})
    assert record["options"]["language"] == "en"


@pytest.mark.parametrize("language,backend", [("zh", "wav2vec2_ctc"), ("mul", "wav2vec2_phoneme_ctc")])
def test_snapshot_language_and_backend_are_bound(language, backend):
    stream = EventStream("test", language=language)
    stream.accept(event(1, "started"))
    fields = dict(revision=1, final=False, audio_available_until=2, lines=[], language=language, timing_backend=backend)
    stream.accept(event(2, "snapshot", **fields))
    for change in ({"language": "en"}, {"timing_backend": "other"}, {"language": None}):
        other = EventStream("test", language=language)
        other.accept(event(1, "started"))
        with pytest.raises(ProtocolError, match="language or timing backend"):
            other.accept(event(2, "snapshot", **(fields | change)))


def test_preflight_passes_resolved_language_and_selected_external_path(tmp_path, monkeypatch):
    service, _ = service_fixture(tmp_path)
    service.runtime.models = SimpleNamespace(require=lambda options: None)
    monkeypatch.setattr("rollingpebble.auto_timing.service.resolve_language", lambda *a: "zh")
    commands = []
    def run(command, **kwargs):
        commands.append(command)
        return SimpleNamespace(returncode=1, stdout=json.dumps(dict(runtime_ok=True, ready=True,
            engine_version="0.10.3", capabilities={"protocol_versions": [2]})))
    monkeypatch.setattr("rollingpebble.auto_timing.service.subprocess.run", run)
    request = RunRequest(project_id="p1", options=Options(ctc_model="/english", ctc_zh_model="/mandarin"))
    checked = AutoTimingService.preflight(service, request)
    assert checked["requested_language"] == "auto" and checked["language"] == "zh"
    assert checked["required_models"] == ["whisper"]
    assert commands[0][commands[0].index("--language") + 1] == "zh"
    assert "/english" not in commands[0] and "/mandarin" in commands[0]
    record, _ = service._record(request, checked=checked)
    payload = json.loads((service.store.folder(record["id"]) / "request.json").read_text())
    assert payload["options"]["language"] == "zh"
    assert payload["options"]["ctc_model"] == "/mandarin"
    assert record["options"]["language"] == "auto" and record["language"] == "zh"


def test_mixed_batch_freezes_each_resolved_language(tmp_path, monkeypatch):
    from rollingpebble.auto_timing.contracts import BatchRequest
    from rollingpebble.models import ProjectModel
    from rollingpebble.storage.files import write_project
    service, layout = service_fixture(tmp_path)
    for pid, text in [("p2", "繁體中文"), ("p3", "Привет")]:
        write_project(layout.projects_root, ProjectModel(project_id=pid, audio_ref="audio.wav"))
        (layout.projects_root / pid / "audio.wav").write_bytes(b"audio")
        (layout.projects_root / pid / "plain.txt").write_text(text)
    languages = {"p1": "en", "p2": "zh", "p3": "mul"}
    def checked(request, **kwargs):
        _, text, identity = service._input(request)
        options, _, _ = service._context(request)
        language = languages[request.project_id]
        return dict(audio_identity=identity, lyrics_hash=hashlib.sha256(text.encode()).hexdigest(),
                    language=language, engine_options=engine_options(options, language))
    service.preflight = checked
    monkeypatch.setattr(service, "_execute", lambda record, env: service.store.update(record["id"], status="completed"))
    parent = service.batch(BatchRequest(project_ids=list(languages)))
    with service.jobs.resource_lock:
        pass
    for rid in parent["children"]:
        record = service.store.get(rid)
        assert record["language"] == languages[record["project_id"]]


def test_prepared_selection_survives_preference_reset(tmp_path):
    store = SettingsStore(tmp_path)
    settings = store.read()
    settings.model_prepared_kinds = ["whisper", "ctc-zh", "demucs"]
    store.write(settings)
    assert store.reset_defaults().model_prepared_kinds == ["whisper", "ctc-zh", "demucs"]
    assert RuntimeSettingsUpdateRequest(model_prepared_kinds=["ctc-mul"]).model_prepared_kinds == ["ctc-mul"]


def test_retry_api_preserves_language_and_rejects_other_workspace(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from rollingpebble.api.auto_timing import create_auto_timing_router
    service, _ = service_fixture(tmp_path)
    request = RunRequest(project_id='p1', options=Options(language='auto'))
    checked = service.preflight(request)
    checked['language'] = 'zh'
    checked['engine_options'] = engine_options(checked['engine_options'], 'zh')
    record, _ = service._record(request, checked=checked)
    service.store.update(record['id'], status='failed')
    checked_calls = []
    original = service.preflight
    def preflight(request, **kwargs):
        checked_calls.append(kwargs)
        value = original(request, **kwargs)
        value["language"] = kwargs.get("language") or value["language"]
        value["engine_options"] = engine_options(value["engine_options"], value["language"])
        return value
    monkeypatch.setattr(service, 'preflight', preflight)
    monkeypatch.setattr(service, '_execute', lambda record, env: service.store.update(record['id'], status='completed'))
    app = FastAPI()
    app.include_router(create_auto_timing_router(SimpleNamespace(auto_timing=service)))
    client = TestClient(app)
    response = client.post(f"/api/auto-timing/runs/{record['id']}/retry", json={'project_id': 'p1', 'options': {'language': 'mul'}})
    assert response.status_code == 400 and checked_calls == []
    response = client.post(f"/api/auto-timing/runs/{record['id']}/retry", json={'project_id': 'p1', 'options': {'language': 'auto'}})
    assert response.status_code == 200
    assert response.json()['language'] == 'zh'
    assert response.json()['options']['language'] == 'auto'
    assert checked_calls == [{'language': 'zh'}]
    import time
    for _ in range(100):
        if not service.jobs.resource_lock.locked():
            break
        time.sleep(.01)
    response = client.post(f"/api/auto-timing/runs/{record['id']}/retry", json={'project_id': 'another'})
    assert response.status_code == 400 and len(checked_calls) == 1


def test_unicode_final_alignment_and_lrc_keep_source(tmp_path):
    from test_auto_timing_v2 import finish_fixture, line
    text = '繁體歌詞 — Привет мир'
    stream, artifacts = finish_fixture(tmp_path, [line(text=text)])
    stream.language = 'zh'
    stream.snapshot.update(language='zh', timing_backend='wav2vec2_ctc')
    from pathlib import Path
    path = Path(artifacts['alignment'])
    alignment = json.loads(path.read_text())
    alignment.update(language='zh', timing_backend='wav2vec2_ctc')
    path.write_text(json.dumps(alignment, ensure_ascii=False))
    assert stream.finish(0, tmp_path)['lines'][0]['text'] == text
    alignment['language'] = 'en'
    path.write_text(json.dumps(alignment))
    with pytest.raises(ProtocolError):
        stream.finish(0, tmp_path)


def test_language_preference_patch_preserves_other_defaults(tmp_path):
    from rollingpebble.runtime.settings import RuntimeSettingsService
    settings = RuntimeSettingsService(tmp_path)
    settings.update(RuntimeSettingsUpdateRequest(auto_timing_v2_options={
        'cpu_threads': 8, 'audio_mode': 'vocals', 'ctc_model': '/english'}))
    for language in ['zh', 'mul', 'en']:
        result = settings.update(RuntimeSettingsUpdateRequest(auto_timing_v2_options={'language': language}))
        assert result.auto_timing_v2_options['language'] == language
        assert result.auto_timing_v2_options['cpu_threads'] == 8
        assert result.auto_timing_v2_options['audio_mode'] == 'vocals'
        assert result.auto_timing_v2_options['ctc_model'] == '/english'
