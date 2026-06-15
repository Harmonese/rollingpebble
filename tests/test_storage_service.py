import json
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from rollingpebble import job_kinds
from rollingpebble.config import Settings
from rollingpebble.main import create_app
from rollingpebble.models import JobModel, JobStatus, StorageCleanupPreviewRequest
from rollingpebble.services.storage_service import StorageService


class FakeJobs:
    def __init__(self, jobs: list[JobModel] | None = None) -> None:
        self._jobs = jobs or []

    def list(self) -> list[JobModel]:
        return self._jobs


def write_file(path: Path, text: str = "data") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_storage_usage_reports_projects_and_other(tmp_path: Path) -> None:
    write_file(tmp_path / "settings.json", "{}")
    write_file(tmp_path / "projects" / "p1" / "project.json", "{}")
    write_file(tmp_path / "projects" / "p1" / "audio.mp3", "audio")
    write_file(tmp_path / "projects" / "p1" / "intermediate" / "run_a" / "chunk.wav", "1234")
    write_file(tmp_path / "projects" / "p1" / "artifacts" / "alignment_result.json", "{}")
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    usage = service.usage()
    categories = {item.id: item for item in usage.categories}

    assert categories["projects"].bytes >= 11
    assert categories["other"].bytes >= 2
    assert usage.projects
    assert usage.projects[0].project_id == "p1"
    assert usage.projects[0].audio_bytes >= 5
    assert usage.projects[0].generated_bytes >= 6


def test_project_generated_cleanup_removes_intermediate_and_artifacts(tmp_path: Path) -> None:
    intermediate_file = tmp_path / "projects" / "p1" / "intermediate" / "run_a" / "chunk.wav"
    artifact_file = tmp_path / "projects" / "p1" / "artifacts" / "alignment_result.json"
    audio_file = tmp_path / "projects" / "p1" / "audio.mp3"
    write_file(intermediate_file, "1234")
    write_file(artifact_file, "keep")
    write_file(audio_file, "audio")
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    plan = service.preview(StorageCleanupPreviewRequest(targets=["clean_project_generated"], project_ids=["p1"], older_than_days=0))
    assert any("intermediate" in entry.relative_path for entry in plan.entries)
    assert any("artifacts" in entry.relative_path for entry in plan.entries)

    result = service.run(type("Request", (), {"plan_id": plan.plan_id, "entry_ids": None})())

    assert result.deleted_count == 2
    assert not intermediate_file.exists()
    assert not artifact_file.exists()
    assert audio_file.exists()


def test_cleanup_blocks_active_project_intermediate(tmp_path: Path) -> None:
    write_file(tmp_path / "projects" / "p1" / "intermediate" / "run_a" / "chunk.wav", "1234")
    service = StorageService(
        data_dir=tmp_path,
        jobs=FakeJobs([JobModel(job_id="j1", kind=job_kinds.AUTO_TIMING, project_id="p1", status=JobStatus.running)]),
    )

    plan = service.preview(StorageCleanupPreviewRequest(targets=["job_intermediates"], older_than_days=0))

    assert plan.entries
    assert plan.entries[0].risk == "blocked"
    assert plan.entries[0].removable is False


def test_cleanup_preview_does_not_follow_symlink(tmp_path: Path) -> None:
    outside = tmp_path.parent / f"outside-{tmp_path.name}"
    outside.mkdir()
    write_file(outside / "secret.txt", "secret")
    models = tmp_path / "models"
    models.mkdir(parents=True)
    link = models / "outside-link"
    link.symlink_to(outside, target_is_directory=True)
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    plan = service.preview(StorageCleanupPreviewRequest(targets=["clean_models"], older_than_days=0))
    entry = next(item for item in plan.entries if item.relative_path == "models/outside-link")
    result = service.run(type("Request", (), {"plan_id": plan.plan_id, "entry_ids": [entry.id]})())

    assert entry.risk == "blocked"
    assert result.deleted_count == 0
    assert result.failed
    assert (outside / "secret.txt").exists()


def test_storage_api_preview_and_run(tmp_path: Path) -> None:
    write_file(tmp_path / "projects" / "p1" / "intermediate" / "run_a" / "chunk.wav", "1234")
    client = TestClient(create_app(Settings(data_dir=tmp_path)))

    usage = client.get("/api/storage/usage")
    assert usage.status_code == 200
    preview = client.post("/api/storage/cleanup/preview", json={"targets": ["safe"], "older_than_days": 0})
    assert preview.status_code == 200
    plan = preview.json()
    assert plan["entries"]

    run = client.post("/api/storage/cleanup/run", json={"plan_id": plan["plan_id"]})
    assert run.status_code == 200
    assert run.json()["deleted_count"] == 1


def test_roll_preview_does_not_write_plain_file(tmp_path: Path) -> None:
    from rollingpebble.models import ProjectModel, RollRequest
    from rollingpebble.services.project_service import ProjectService
    from rollingpebble.services.roller_service import RollerService
    from rollingpebble.storage.files import PLAIN_NAME, SYNCED_NAME, write_project, write_text

    projects_root = tmp_path / "projects"
    project_id = "p1"
    audio_path = projects_root / project_id / "audio.mp3"
    write_file(audio_path, "audio")
    write_project(projects_root, ProjectModel(project_id=project_id, audio_name="audio.mp3", audio_path=str(audio_path)))
    write_text(projects_root, project_id, SYNCED_NAME, "[00:01.00]hello")
    plain_path = projects_root / project_id / PLAIN_NAME
    if plain_path.exists():
        plain_path.unlink()

    service = RollerService(
        projects_root=projects_root,
        project_service=ProjectService(projects_root),
        jobs=FakeJobs(),
        runtime_manager=None,
    )

    preview = service.preview(project_id, RollRequest(stages="p,a,w"))

    assert preview.command
    assert not plain_path.exists()


def test_batch_tasks_do_not_infer_untracked_audio_file(tmp_path: Path) -> None:
    from rollingpebble.models import BatchRollRequest, ProjectModel
    from rollingpebble.services.project_service import ProjectService
    from rollingpebble.services.roller_service import RollerService
    from rollingpebble.storage.files import write_project

    projects_root = tmp_path / "projects"
    project_id = "p1"
    write_file(projects_root / project_id / "song.mp3", "audio")
    write_project(projects_root, ProjectModel(project_id=project_id))
    service = RollerService(
        projects_root=projects_root,
        project_service=ProjectService(projects_root),
        jobs=FakeJobs(),
        runtime_manager=None,
    )

    tasks = service._build_batch_tasks([project_id], BatchRollRequest(project_ids=[project_id], stages="t,p,a,w"))

    assert tasks == [{"id": project_id, "output_roller": str(projects_root / project_id / "pyroller_output.lrc")}]


def test_project_audio_path_is_stored_as_relative_ref(tmp_path: Path) -> None:
    from rollingpebble.models import ProjectModel
    from rollingpebble.storage.files import read_project, write_project

    projects_root = tmp_path / "projects"
    audio_path = projects_root / "p1" / "audio.mp3"
    write_file(audio_path, "audio")

    write_project(projects_root, ProjectModel(project_id="p1", audio_name="audio.mp3", audio_path=str(audio_path)))

    raw = json.loads((projects_root / "p1" / "project.json").read_text(encoding="utf-8"))
    assert raw["audio_ref"] == "audio.mp3"
    assert raw["audio_path"] is None
    project = read_project(projects_root, "p1")
    assert project.audio_ref == "audio.mp3"
    assert project.audio_path == str(audio_path)


def test_legacy_project_audio_path_migrates_to_relative_ref_on_write(tmp_path: Path) -> None:
    from rollingpebble.storage.files import read_project, write_project

    projects_root = tmp_path / "projects"
    audio_path = projects_root / "p1" / "audio.mp3"
    write_file(audio_path, "audio")
    write_file(projects_root / "p1" / "project.json", json.dumps({"project_id": "p1", "audio_path": str(audio_path)}))

    project = read_project(projects_root, "p1")
    assert project.audio_ref == "audio.mp3"
    assert project.audio_path == str(audio_path)

    write_project(projects_root, project)
    raw = json.loads((projects_root / "p1" / "project.json").read_text(encoding="utf-8"))
    assert raw["audio_ref"] == "audio.mp3"
    assert raw["audio_path"] is None


def test_migrate_projects_root_updates_settings_and_keeps_backup(tmp_path: Path) -> None:
    from rollingpebble.storage.app_settings import SettingsStore

    project_file = tmp_path / "projects" / "p1" / "project.json"
    write_file(project_file, '{"project_id": "p1"}')
    target = tmp_path / "moved-projects"
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    result = service.migrate_root("projects", str(target))

    assert result.root.path == str(target.resolve())
    assert (target / "p1" / "project.json").exists()
    assert result.backup_path is not None
    assert Path(result.backup_path).exists()
    assert SettingsStore(tmp_path).read().storage_projects_root == str(target.resolve())
    assert service.projects_root == target.resolve()


def test_migrate_projects_root_rejects_non_empty_target(tmp_path: Path) -> None:
    write_file(tmp_path / "projects" / "p1" / "project.json", '{"project_id": "p1"}')
    target = tmp_path / "target"
    write_file(target / "existing.txt", "keep")
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    with pytest.raises(ValueError, match="Target directory must be empty"):
        service.migrate_root("projects", str(target))


def test_delete_project_removes_whole_project(tmp_path: Path) -> None:
    project_file = tmp_path / "projects" / "p1" / "project.json"
    write_file(project_file, "{}")
    write_file(tmp_path / "projects" / "p1" / "audio.mp3", "audio")
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    plan = service.preview(StorageCleanupPreviewRequest(targets=["delete_projects"], project_ids=["p1"], older_than_days=0))
    assert len(plan.entries) == 1
    assert plan.entries[0].category == "project"

    result = service.run(type("Request", (), {"plan_id": plan.plan_id, "entry_ids": None})())

    assert result.deleted_count == 1
    assert not (tmp_path / "projects" / "p1").exists()


def test_project_auto_delete_removes_only_expired_inactive_projects(tmp_path: Path) -> None:
    write_file(tmp_path / "settings.json", '{"project_auto_delete_days": 7}')
    old_project = tmp_path / "projects" / "old" / "project.json"
    active_project = tmp_path / "projects" / "active" / "project.json"
    fresh_project = tmp_path / "projects" / "fresh" / "project.json"
    write_file(old_project, "{}")
    write_file(active_project, "{}")
    write_file(fresh_project, "{}")
    old_time = time.time() - 10 * 86400
    os.utime(old_project.parent, (old_time, old_time))
    os.utime(active_project.parent, (old_time, old_time))

    service = StorageService(
        data_dir=tmp_path,
        jobs=FakeJobs([JobModel(job_id="j1", kind=job_kinds.AUTO_TIMING, project_id="active", status=JobStatus.running)]),
    )

    usage = service.usage()

    assert not old_project.parent.exists()
    assert active_project.parent.exists()
    assert fresh_project.parent.exists()
    assert {project.project_id for project in usage.projects} == {"active", "fresh"}


def test_delete_project_audio_updates_project_metadata(tmp_path: Path) -> None:
    from rollingpebble.models import ProjectModel
    from rollingpebble.storage.files import write_project

    audio_file = tmp_path / "projects" / "p1" / "audio.mp3"
    write_file(audio_file, "audio")
    write_project(tmp_path / "projects", ProjectModel(project_id="p1", audio_name="audio.mp3", audio_path=str(audio_file)))
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    plan = service.preview(StorageCleanupPreviewRequest(targets=["delete_project_audio"], project_ids=["p1"], older_than_days=0))
    result = service.run(type("Request", (), {"plan_id": plan.plan_id, "entry_ids": None})())

    assert result.deleted_count == 1
    assert not audio_file.exists()
    project = ProjectModel.model_validate_json((tmp_path / "projects" / "p1" / "project.json").read_text(encoding="utf-8"))
    assert project.audio_name is None
    assert project.audio_path is None


def test_clear_intermediate_removes_only_intermediate(tmp_path: Path) -> None:
    intermediate_file = tmp_path / "projects" / "p1" / "intermediate" / "run_a" / "chunk.wav"
    artifact_file = tmp_path / "projects" / "p1" / "artifacts" / "alignment_result.json"
    write_file(intermediate_file, "1234")
    write_file(artifact_file, "keep")
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    plan = service.preview(StorageCleanupPreviewRequest(targets=["clear_intermediate"], project_ids=["p1"], older_than_days=0))
    assert len(plan.entries) == 1
    assert plan.entries[0].category == "project_intermediate"

    result = service.run(type("Request", (), {"plan_id": plan.plan_id, "entry_ids": None})())

    assert result.deleted_count == 1
    assert not (tmp_path / "projects" / "p1" / "intermediate").exists()
    assert artifact_file.exists()


def test_clear_intermediate_ignores_age_filter_for_selected_projects(tmp_path: Path) -> None:
    chunk = tmp_path / "projects" / "p1" / "intermediate" / "run_a" / "chunk.wav"
    log = tmp_path / "projects" / "p1" / "intermediate" / "run_a" / "logs" / "run.log"
    write_file(chunk, "1234")
    write_file(log, "log")
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    plan = service.preview(StorageCleanupPreviewRequest(targets=["clear_intermediate"], project_ids=["p1"], older_than_days=30))

    assert len(plan.entries) == 1
    assert plan.entries[0].bytes >= 7
    result = service.run(type("Request", (), {"plan_id": plan.plan_id, "entry_ids": None})())

    assert result.deleted_count == 1
    assert not (tmp_path / "projects" / "p1" / "intermediate").exists()


def test_other_items_label_known_app_data_and_ignore_system_files(tmp_path: Path) -> None:
    write_file(tmp_path / "settings.json", "{}")
    write_file(tmp_path / "cache" / "pip" / "http-v2" / "cache.bin", "cache")
    write_file(tmp_path / ".DS_Store", "junk")
    write_file(tmp_path / "debug.txt", "debug")
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    usage = service.usage()
    labels = {item.relative_path: item.label for item in usage.other_items}

    assert labels["settings.json"] == "Settings File"
    assert labels["cache"] == "External Cache"
    assert labels["debug.txt"] == "debug.txt"
    assert ".DS_Store" not in labels
    assert next(item for item in usage.other_items if item.relative_path == "settings.json").removable is False
    assert next(item for item in usage.other_items if item.relative_path == "cache").removable is True


def test_other_cleanup_deletes_items_but_protects_settings(tmp_path: Path) -> None:
    settings_file = tmp_path / "settings.json"
    debug_file = tmp_path / "debug.txt"
    write_file(settings_file, "{}")
    write_file(debug_file, "debug")
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    plan = service.preview(StorageCleanupPreviewRequest(targets=["delete_other_items"], other_paths=["debug.txt", "settings.json"], older_than_days=0))
    entries = {entry.relative_path: entry for entry in plan.entries}

    assert entries["debug.txt"].removable is True
    assert entries["settings.json"].removable is False

    result = service.run(type("Request", (), {"plan_id": plan.plan_id, "entry_ids": None})())

    assert result.deleted_count == 1
    assert not debug_file.exists()
    assert settings_file.exists()


def test_safe_cleanup_removes_intermediate_and_external_cache(tmp_path: Path) -> None:
    intermediate_file = tmp_path / "projects" / "p1" / "intermediate" / "run_a" / "chunk.wav"
    cache_file = tmp_path / "cache" / "pip" / "http-v2" / "cache.bin"
    settings_file = tmp_path / "settings.json"
    write_file(intermediate_file, "1234")
    write_file(cache_file, "cache")
    write_file(settings_file, "{}")
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    plan = service.preview(StorageCleanupPreviewRequest(targets=["safe"], older_than_days=0))
    paths = {entry.relative_path for entry in plan.entries}

    assert "projects/p1/intermediate" in paths
    assert "cache" in paths

    result = service.run(type("Request", (), {"plan_id": plan.plan_id, "entry_ids": None})())

    assert result.deleted_count == 2
    assert not (tmp_path / "projects" / "p1" / "intermediate").exists()
    assert not (tmp_path / "cache").exists()
    assert settings_file.exists()


def test_other_open_path_uses_parent_for_files_and_self_for_directories(tmp_path: Path) -> None:
    write_file(tmp_path / "debug.txt", "debug")
    write_file(tmp_path / "cache" / "pip" / "http-v2" / "cache.bin", "cache")
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    assert service.other_item_open_path("debug.txt") == tmp_path.resolve()
    assert service.other_item_open_path("cache") == (tmp_path / "cache").resolve()


def test_storage_usage_reports_project_intermediate_bytes(tmp_path: Path) -> None:
    write_file(tmp_path / "projects" / "p1" / "project.json", "{}")
    write_file(tmp_path / "projects" / "p1" / "intermediate" / "run_a" / "chunk.wav", "1234")
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    usage = service.usage()
    project = next(item for item in usage.projects if item.project_id == "p1")

    assert project.intermediate_bytes >= 4
    assert project.has_intermediate is True


def test_model_cache_counts_entire_models_folder_and_cleans_model_items(tmp_path: Path) -> None:
    write_file(tmp_path / "models" / "model" / "weights.bin", "123456")
    write_file(tmp_path / "models" / "transcriber" / "providers" / "huggingface" / "hub" / "models--Org--Repo" / "snapshots" / "abc" / "config.json", "hf")
    write_file(tmp_path / "settings.json", "{}")
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    usage = service.usage()
    categories = {item.id: item for item in usage.categories}

    assert categories["models"].bytes >= 8
    assert categories["other"].bytes < usage.total_bytes

    plan = service.preview(StorageCleanupPreviewRequest(targets=["clean_models"], older_than_days=0))
    paths = {entry.relative_path for entry in plan.entries}

    assert "models/model" in paths
    assert "models/transcriber/providers/huggingface/hub/models--Org--Repo" in paths
    assert "models/transcriber" not in paths


def test_model_items_ignore_hidden_files_locks_and_manifest(tmp_path: Path) -> None:
    write_file(tmp_path / "models" / ".DS_Store", "junk")
    write_file(tmp_path / "models" / "transcriber" / ".DS_Store", "junk")
    write_file(tmp_path / "models" / "transcriber" / "manifests" / "transcriber-index.json", '{"models": {}}')
    (tmp_path / "models" / "transcriber" / "providers" / "huggingface" / "hub" / ".locks").mkdir(parents=True)
    write_file(tmp_path / "models" / "transcriber" / "providers" / "huggingface" / "hub" / "models--Org--Repo" / "snapshots" / "abc" / "config.json", "hf")
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    usage = service.usage()
    paths = {item.relative_path for item in usage.models}

    assert "models/.DS_Store" not in paths
    assert "models/transcriber/.DS_Store" not in paths
    assert "models/transcriber/manifests" not in paths
    assert "models/transcriber/providers/huggingface/hub/.locks" not in paths
    assert "models/transcriber/providers/huggingface/hub/models--Org--Repo" in paths


def test_deleting_model_prunes_transcriber_manifest(tmp_path: Path) -> None:
    model_dir = tmp_path / "models" / "transcriber" / "providers" / "huggingface" / "hub" / "models--Org--Repo"
    snapshot = model_dir / "snapshots" / "abc"
    write_file(snapshot / "config.json", "hf")
    manifest = tmp_path / "models" / "transcriber" / "manifests" / "transcriber-index.json"
    write_file(manifest, '{"models": {"mms_phonetic:Org/Repo": {"backend": "mms_phonetic", "effective_model_name": "Org/Repo", "provider": "hf_repo", "resolved_model_dir": "' + snapshot.as_posix() + '"}, "faster_whisper:large-v2": {"backend": "faster_whisper", "effective_model_name": "large-v2", "resolved_model_dir": "' + (tmp_path / "models" / "transcriber" / "providers" / "faster_whisper" / "hub" / "models--Systran--faster-whisper-large-v2" / "snapshots" / "def").as_posix() + '"}}}')
    service = StorageService(data_dir=tmp_path, jobs=FakeJobs())

    item = next(item for item in service.usage().models if item.relative_path == "models/transcriber/providers/huggingface/hub/models--Org--Repo")
    plan = service.preview(StorageCleanupPreviewRequest(targets=["delete_model_items"], model_ids=[item.id], older_than_days=0))
    result = service.run(type("Request", (), {"plan_id": plan.plan_id, "entry_ids": None})())

    assert result.deleted_count == 1
    payload = __import__("json").loads(manifest.read_text(encoding="utf-8"))
    assert "mms_phonetic:Org/Repo" not in payload["models"]
    assert "faster_whisper:large-v2" in payload["models"]
