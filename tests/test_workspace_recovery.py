import asyncio
import io
import json
import uuid

import pytest
from fastapi import UploadFile
from fastapi.testclient import TestClient

from rollingpebble.config import Settings
from rollingpebble.main import create_app
from rollingpebble.models import ApplyLyricsRequest, WorkspaceSaveRequest
from rollingpebble.services.project_service import ProjectService
from rollingpebble.storage import transaction


def test_recovery_audio_is_not_a_project_and_survives_restart(tmp_path):
    headers = {"x-rollingpebble-client": "workspace"}
    record = {"version": 1, "draft_id": str(uuid.uuid4()), "snapshot": {
        "synced_lyrics": "[00:01.00]Line", "metadata": {"track": "Title"}},
        "dirty": True, "audio_key": str(uuid.uuid4()), "audio_name": "song.wav",
        "editor": {"mode": "text", "texts": ["[00:bad]Unfinished"]}}
    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        url = "/api/workspace/recovery"
        assert client.put(url, data={"record": json.dumps(record)}).status_code == 403
        result = client.put(url, headers=headers, data={"record": json.dumps(record)}, files={"audio": ("song.wav", b"audio")})
        assert result.status_code == 200, result.text
        assert client.get("/api/projects").json() == []
        assert client.put(url, headers=headers, data={"record": json.dumps(record)}).status_code == 200
        assert len(list((tmp_path / "recovery").glob("*.audio"))) == 1
    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        assert client.get(url).json()["editor"] == record["editor"]
        assert client.get(f'{url}/audio/{record["audio_key"]}').content == b"audio"
        broken = {**record, "audio_key": str(uuid.uuid4())}
        assert client.put(url, headers=headers, data={"record": json.dumps(broken)}).status_code == 400
        assert client.get(url).json()["audio_key"] == record["audio_key"]
        # A committed project reuses its audio and releases the temporary copy.
        clean = {**record, "project_id": "a" * 12, "audio_key": None, "dirty": False, "editor": None}
        assert client.put(url, headers=headers, data={"record": json.dumps(clean)}).status_code == 200
        assert not list((tmp_path / "recovery").glob("*.audio"))
        assert client.delete(url, headers=headers).status_code == 200
        assert client.get(url).json() is None


def test_first_save_retry_after_restart_keeps_identity_and_new_audio(tmp_path):
    draft = str(uuid.uuid4())
    service = ProjectService(tmp_path)
    first = asyncio.run(service.save_workspace(draft, UploadFile(io.BytesIO(b"first"), filename="first.wav"),
        WorkspaceSaveRequest(synced_lyrics="First")))
    reopened = ProjectService(tmp_path)
    recovered = reopened.get(uuid.UUID(draft).hex)
    second = asyncio.run(reopened.replace_workspace_audio(recovered.project_id, UploadFile(io.BytesIO(b"second"), filename="second.wav"),
        WorkspaceSaveRequest(synced_lyrics="Second")))
    assert second.project_id == first.project_id
    assert second.audio_name == "second.wav"
    assert second.synced_lyrics == "Second"
    assert len(reopened.list_projects()) == 1
    assert len(list((tmp_path / second.project_id).glob("audio*"))) == 1


@pytest.mark.parametrize("fail_at", [1, 2, 3, 4])
def test_interrupted_save_is_complete_after_recovery(tmp_path, monkeypatch, fail_at):
    service = ProjectService(tmp_path)
    old = asyncio.run(service.save_workspace(str(uuid.uuid4()), UploadFile(io.BytesIO(b"audio"), filename="song.wav"),
        WorkspaceSaveRequest(synced_lyrics="[00:01.00]Old")))
    source = "[00:02.00]New\r\n[00:03.00]Again"
    doc = {"version": 1, "source_lrc": source, "target_language": "zh", "lines": [
        {"id": "one", "time": 2, "text": "New", "translation": "新", "source_text": "New"},
        {"id": "two", "time": 3, "text": "Again", "translation": "再", "source_text": "Again"}]}
    original = transaction.atomic_text
    calls = 0
    def interrupted(path, text):
        nonlocal calls
        calls += 1
        if calls == fail_at:
            raise OSError("disk full")
        return original(path, text)
    monkeypatch.setattr(transaction, "atomic_text", interrupted)
    with pytest.raises(OSError):
        service.apply_lyrics(old.project_id, ApplyLyricsRequest(synced_lyrics=source, lyric_document=doc))
    monkeypatch.setattr(transaction, "atomic_text", original)
    reopened = ProjectService(tmp_path).get(old.project_id)
    if fail_at == 1:
        assert reopened.synced_lyrics == old.synced_lyrics
        assert reopened.lyric_document is None
    else:
        assert reopened.synced_lyrics == source.replace("\r\n", "\n")
        assert reopened.lyric_document.model_dump() == doc
    assert not (tmp_path / old.project_id / transaction.JOURNAL).exists()
