import asyncio
import io
import json
import uuid
from pathlib import Path

import pytest
from fastapi import UploadFile
from fastapi.testclient import TestClient

from rollingpebble.config import Settings
from rollingpebble.main import create_app
from rollingpebble.models import WorkspaceSaveRequest
from rollingpebble.services.project_service import ProjectService


def test_workspace_save_is_complete_and_idempotent(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(data_dir=tmp_path)))
    draft_id = str(uuid.uuid4())
    snapshot = {
        "metadata": {"track": "User title", "artist": "Singer", "duration": 5},
        "synced_lyrics": "[00:01.00]First line\n[00:02.00]Second line",
        "source": "lrclib", "lrclib_id": 123,
    }
    url = f"/api/projects/drafts/{draft_id}"
    first = client.put(url, data={"snapshot": json.dumps(snapshot)}, files={"audio": ("song.wav", b"test audio")})
    assert first.status_code == 200, first.text
    project = first.json()
    assert project["metadata"]["track"] == "User title"
    assert project["synced_lyrics"] == snapshot["synced_lyrics"]
    assert project["source"] == "lrclib" and project["lrclib_id"] == 123
    audio_path = Path(project["audio_path"])
    assert audio_path.is_file() and audio_path.read_bytes() == b"test audio"
    second = client.put(url, data={"snapshot": json.dumps(snapshot)}, files={"audio": ("song.wav", b"retry must not replace")})
    assert second.status_code == 200
    assert second.json()["project_id"] == project["project_id"]
    assert audio_path.read_bytes() == b"test audio"
    assert len(client.get("/api/projects").json()) == 1
    assert len(list((tmp_path / "projects").iterdir())) == 1
    assert client.post(f'/api/projects/{project["project_id"]}/lyrics', json={**snapshot, "synced_lyrics": "[00:03.00]Edited"}).status_code == 200
    assert audio_path.read_bytes() == b"test audio"


def test_failed_creation_leaves_no_project_and_can_retry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = ProjectService(tmp_path)
    original = ProjectService.apply_lyrics
    def fail(*args, **kwargs):
        raise OSError("disk full")
    monkeypatch.setattr(ProjectService, "apply_lyrics", fail)
    draft_id = str(uuid.uuid4())
    snapshot = WorkspaceSaveRequest(synced_lyrics="[00:01.00]Line")
    with pytest.raises(OSError, match="disk full"):
        asyncio.run(service.save_workspace(draft_id, UploadFile(io.BytesIO(b"audio"), filename="song.wav"), snapshot))
    assert list(tmp_path.iterdir()) == []
    monkeypatch.setattr(ProjectService, "apply_lyrics", original)
    saved = asyncio.run(service.save_workspace(draft_id, UploadFile(io.BytesIO(b"audio"), filename="song.wav"), snapshot))
    assert saved.synced_lyrics == snapshot.synced_lyrics
    assert len(list(tmp_path.iterdir())) == 1


def test_concurrent_saves_of_same_draft_create_one_project(tmp_path: Path) -> None:
    service = ProjectService(tmp_path)
    draft_id = str(uuid.uuid4())
    async def run():
        return await asyncio.gather(*[
            service.save_workspace(draft_id, UploadFile(io.BytesIO(b"audio"), filename="song.wav"), WorkspaceSaveRequest())
            for _ in range(2)
        ])
    saved = asyncio.run(run())
    assert saved[0].project_id == saved[1].project_id
    assert len(service.list_projects()) == 1


def test_metadata_preview_and_invalid_save_do_not_create_projects(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(data_dir=tmp_path)))
    response = client.post("/api/audio/metadata", json={"filename": "song.wav", "metadata": {"track": "Title"}})
    assert response.status_code == 200 and response.json()["track"] == "Title"
    response = client.put(f"/api/projects/drafts/{uuid.uuid4()}", data={"snapshot": "not json"})
    assert response.status_code == 400
    response = client.put("/api/projects/drafts/not-a-uuid", data={"snapshot": "{}"})
    assert response.status_code == 400
    assert client.get("/api/projects").json() == []
    assert list((tmp_path / "projects").iterdir()) == []


def test_lyrics_only_workspace_can_be_saved(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(data_dir=tmp_path)))
    response = client.put(f"/api/projects/drafts/{uuid.uuid4()}", data={"snapshot": json.dumps({"plain_lyrics": "First line", "source": "local file"})})
    assert response.status_code == 200
    assert response.json()["plain_lyrics"] == "First line"
    assert response.json()["audio_path"] is None


def test_replace_audio_preserves_project_and_updates_snapshot(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(data_dir=tmp_path)))
    snapshot = {"synced_lyrics": "[00:01.00]Keep timing", "source": "lrclib", "lrclib_id": 42,
                "metadata": {"track": "Manual title", "duration": 12}}
    created = client.put(f"/api/projects/drafts/{uuid.uuid4()}", data={"snapshot": json.dumps(snapshot)},
                         files={"audio": ("old.wav", b"old")}).json()
    project_id = created["project_id"]
    old_audio = Path(created["audio_path"])
    artifacts = old_audio.parent / "artifacts"
    artifacts.mkdir()
    (artifacts / "old-output").write_text("stale")
    url = f"/api/projects/{project_id}/audio"
    for filename in ["new.mp3", "new.mp3"]:
        response = client.put(url, data={"snapshot": json.dumps(snapshot)}, files={"audio": (filename, b"new")})
        assert response.status_code == 200, response.text
        updated = response.json()
        assert updated["project_id"] == project_id
        assert updated["audio_name"] == filename
        assert updated["synced_lyrics"] == snapshot["synced_lyrics"]
        assert updated["metadata"]["track"] == "Manual title"
        assert updated["source"] == "lrclib" and updated["lrclib_id"] == 42
        assert client.get(url).content == b"new"
        assert not old_audio.exists()
        assert not artifacts.exists()
        old_audio = Path(updated["audio_path"])
        assert len(list(old_audio.parent.glob("audio*"))) == 1
    assert len(client.get("/api/projects").json()) == 1


def test_replace_audio_failure_keeps_saved_workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = ProjectService(tmp_path)
    snapshot = WorkspaceSaveRequest(synced_lyrics="[00:01.00]Original")
    original = asyncio.run(service.save_workspace(str(uuid.uuid4()), UploadFile(io.BytesIO(b"old"), filename="song.wav"), snapshot))
    def fail(*args, **kwargs):
        raise OSError("disk full")
    monkeypatch.setattr(ProjectService, "apply_lyrics", fail)
    with pytest.raises(OSError, match="disk full"):
        asyncio.run(service.replace_workspace_audio(original.project_id, UploadFile(io.BytesIO(b"new"), filename="song.wav"), snapshot))
    assert service.get(original.project_id).synced_lyrics == snapshot.synced_lyrics
    assert Path(original.audio_path).read_bytes() == b"old"
    assert len(list(tmp_path.iterdir())) == 1


def test_saved_lyrics_only_project_can_receive_audio(tmp_path: Path) -> None:
    service = ProjectService(tmp_path)
    snapshot = WorkspaceSaveRequest(synced_lyrics="[00:01.00]Keep")
    original = asyncio.run(service.save_workspace(str(uuid.uuid4()), None, snapshot))
    updated = asyncio.run(service.replace_workspace_audio(original.project_id, UploadFile(io.BytesIO(b"audio"), filename="song.wav"), snapshot))
    assert updated.project_id == original.project_id
    assert updated.synced_lyrics == original.synced_lyrics
    assert Path(updated.audio_path).read_bytes() == b"audio"


def test_audio_replacement_waits_for_running_jobs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from rollingpebble import job_kinds
    client = TestClient(create_app(Settings(data_dir=tmp_path)))
    monkeypatch.setattr(job_kinds, "has_running_job", lambda *args: True)
    response = client.put("/api/projects/example/audio", data={"snapshot": "{}"}, files={"audio": ("song.wav", b"new")})
    assert response.status_code == 409
    assert client.get("/api/projects").json() == []
