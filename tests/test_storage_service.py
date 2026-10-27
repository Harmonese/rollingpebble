import json
import threading
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from rollingpebble.config import Settings
from rollingpebble.main import create_app
from rollingpebble.paths import StorageLayout
from rollingpebble.services.storage_service import StorageService
from rollingpebble.storage.transition import begin_layout_transition, finish_layout_transition, transfer, tree_digest


def write(path, value="data"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value)


def symlink(link, target, *, target_is_directory=False):
    try:
        link.symlink_to(target, target_is_directory=target_is_directory)
    except OSError as exc:
        if getattr(exc, "winerror", None) == 1314:
            pytest.skip("Windows account lacks symlink privilege (Developer Mode is disabled)")
        raise


def service(root):
    return StorageService(layout=StorageLayout.from_data_dir(root).ensure(), jobs=SimpleNamespace(resource_lock=threading.Lock()))


def test_layout_has_only_one_root(tmp_path):
    layout = StorageLayout.from_data_dir(tmp_path).ensure()
    assert {p.name for p in tmp_path.iterdir()} == {"projects", "engine", "runtime", "results", "cache"}
    assert layout.models_root == tmp_path / "engine/models"


def test_inventory_and_clear_cache_preserve_owned_data(tmp_path):
    svc = service(tmp_path)
    for name in ("engine/models/weight", "projects/p/audio.mp3", "results/p/r/draft.json",
                 "runtime/python/bin/python", "cache/pip/item", "engine/ctc/evidence"):
        write(tmp_path / name)
    usage = svc.usage()
    assert usage.total_bytes == 24
    assert sum(row.bytes for row in usage.categories) == usage.total_bytes
    assert {row.id for row in usage.categories} == {"projects", "models", "cache", "results", "components"}
    svc.clear_cache()
    for name in ("engine/models/weight", "projects/p/audio.mp3", "results/p/r/draft.json", "runtime/python/bin/python"):
        assert (tmp_path / name).exists()
    assert not (tmp_path / "cache/pip").exists()
    assert not (tmp_path / "engine/ctc").exists()


def test_cache_lock_prevents_partial_deletion(tmp_path):
    svc = service(tmp_path)
    write(tmp_path / "cache/pip/item")
    write(tmp_path / "engine/ctc/a.lock")
    with pytest.raises(ValueError, match="locks"):
        svc.clear_cache()
    assert (tmp_path / "cache/pip/item").exists()


def test_cache_symlink_cannot_delete_external_files(tmp_path):
    root = tmp_path / "app"
    svc = service(root)
    external = tmp_path / "external"
    write(external / "weight")
    symlink(root / "cache/pip", external, target_is_directory=True)
    with pytest.raises(ValueError):
        svc.clear_cache()
    assert (external / "weight").exists()


def test_usage_does_not_apply_old_auto_delete_policy(tmp_path):
    write(tmp_path / "settings.json", json.dumps({"project_auto_delete_days": 1}))
    write(tmp_path / "projects/p/project.json", json.dumps({"project_id": "p", "last_opened_at": "2000-01-01T00:00:00Z"}))
    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        assert client.get("/api/storage/usage").status_code == 200
        assert (tmp_path / "projects/p").exists()
        schema = client.get("/openapi.json").json()
        assert "/api/storage/cleanup/run" not in schema["paths"]
        assert "/api/storage/migrate-root" not in schema["paths"]
        assert "storage_projects_root" not in schema["components"]["schemas"]["RuntimeSettingsModel"]["properties"]


def legacy(root):
    write(root / "settings.json", json.dumps({"auto_roller_profile": "cu124", "recent_projects_limit": 3}))
    write(root / "projects/p/audio.mp3", "audio")
    write(root / "cache/pyroller/models/weight", "weight")
    write(root / "envs/old/.venv/item", "old")
    write(root / "toolchains/python3.12/bin/python", "old")
    write(root / "models/transcriber/item", "old")
    write(root / "work/jobs/old/log", "old")
    folder = root / "work/auto-timing/p/r"
    write(folder / "record.json", json.dumps({"artifacts": {"alignment": str(folder / "output/alignment.json")}}))
    write(folder / "draft.json", "{}")
    write(root / "settings.pre-protocol-v2.json", "{}")


def test_transition_preserves_data_then_removes_legacy(tmp_path):
    legacy(tmp_path)
    original = tree_digest(tmp_path / "projects")
    begin_layout_transition(tmp_path)
    assert tree_digest(tmp_path / "projects") == original
    assert (tmp_path / "engine/models/weight").read_text() == "weight"
    assert (tmp_path / "envs").exists()
    assert (tmp_path / "results/p/r/draft.json").exists()
    record = json.loads((tmp_path / "results/p/r/record.json").read_text())
    assert record["artifacts"]["alignment"] == str(tmp_path / "results/p/r/output/alignment.json")
    # Reentry is safe even after the results' readable paths have changed.
    begin_layout_transition(tmp_path)
    finish_layout_transition(tmp_path)
    for name in ("envs", "toolchains", "models", "work", "cache/pyroller", "settings.pre-protocol-v2.json", ".layout-transition.json"):
        assert not (tmp_path / name).exists()
    assert (tmp_path / "projects/p/audio.mp3").read_text() == "audio"


def test_transition_copy_failure_retains_source_and_can_retry(tmp_path, monkeypatch):
    import rollingpebble.storage.transition as module
    legacy(tmp_path)
    original = module.shutil.copytree
    def fail(*args, **kwargs):
        raise OSError("disk full")
    monkeypatch.setattr(module.shutil, "copytree", fail)
    with pytest.raises(OSError):
        begin_layout_transition(tmp_path)
    assert (tmp_path / "cache/pyroller/models/weight").exists()
    monkeypatch.setattr(module.shutil, "copytree", original)
    begin_layout_transition(tmp_path)
    assert (tmp_path / "engine/models/weight").exists()


def test_transfer_rejects_conflicts_and_external_links(tmp_path):
    write(tmp_path / "a/file", "first")
    write(tmp_path / "b/file", "second")
    with pytest.raises(ValueError, match="different"):
        transfer(tmp_path / "a", tmp_path / "b")
    symlink(tmp_path / "a/link", tmp_path / "b/file")
    with pytest.raises(ValueError, match="External"):
        tree_digest(tmp_path / "a")


def test_transfer_rebases_internal_absolute_model_links(tmp_path):
    import shutil
    write(tmp_path / "source/blobs/weight", "model")
    symlink(tmp_path / "source/current", tmp_path / "source/blobs/weight")
    transfer(tmp_path / "source", tmp_path / "target")
    shutil.rmtree(tmp_path / "source")
    assert (tmp_path / "target/current").read_text() == "model"


def test_root_relocation_and_runtime_failure(tmp_path, monkeypatch):
    import rollingpebble.services.storage_migration as module
    source, target = tmp_path / "source", tmp_path / "target"
    svc = service(source)
    svc.runtime_manager = SimpleNamespace(_read_runtime_metadata=lambda _: {})
    write(source / "projects/p/audio.mp3", "audio")
    write(source / "engine/models/weight", "weight")
    write(source / "settings.json", "{}")
    pointer = tmp_path / "config/storage.json"
    monkeypatch.setenv("ROLLINGPEBBLE_LOCATION_FILE", str(pointer))
    def fail(*args, **kwargs): raise OSError("runtime failure")
    monkeypatch.setattr(module, "install_runtime", fail)
    with pytest.raises(OSError, match="runtime failure"):
        module.relocate(svc, str(target), lambda: None)
    assert not pointer.exists()
    assert (source / "projects/p/audio.mp3").exists()
    monkeypatch.setattr(module, "install_runtime", lambda *args, **kwargs: None)
    module.relocate(svc, str(target), lambda: None)
    assert json.loads(pointer.read_text())["path"] == str(target)
    assert not source.exists()
    assert (target / "projects/p/audio.mp3").read_text() == "audio"
    assert (target / "engine/models/weight").read_text() == "weight"


def test_relocation_rejects_overlaps_and_nonempty_target(tmp_path):
    from rollingpebble.services.storage_migration import relocate
    svc = service(tmp_path / "source")
    with pytest.raises(ValueError, match="overlap"):
        relocate(svc, str(svc.data_dir / "nested"), lambda: None)
    write(tmp_path / "target/file")
    with pytest.raises(ValueError, match="empty"):
        relocate(svc, str(tmp_path / "target"), lambda: None)


def test_relocation_cleanup_resumes_after_partial_deletion(tmp_path, monkeypatch):
    import rollingpebble.services.storage_migration as module
    source, target = tmp_path / "source", tmp_path / "target"
    svc = service(source)
    svc.runtime_manager = SimpleNamespace(_read_runtime_metadata=lambda _: {})
    write(source / "projects/p/audio", "audio")
    write(source / "projects/p/lyrics", "lyrics")
    write(source / "engine/models/weight", "weight")
    write(source / "settings.json", "{}")
    monkeypatch.setenv("ROLLINGPEBBLE_LOCATION_FILE", str(tmp_path / "config/storage.json"))
    monkeypatch.setattr(module, "install_runtime", lambda *args, **kwargs: None)
    original = module.shutil.rmtree
    def fail(path, *args, **kwargs):
        if path == source / "projects":
            (path / "p/audio").unlink()
            raise OSError("busy file")
        return original(path, *args, **kwargs)
    monkeypatch.setattr(module.shutil, "rmtree", fail)
    with pytest.raises(OSError, match="busy file"):
        module.relocate(svc, str(target), lambda: None)
    assert svc.data_dir == target
    monkeypatch.setattr(module.shutil, "rmtree", original)
    module.finish_relocation(target)
    assert not source.exists()
    assert (target / "projects/p/audio").read_text() == "audio"
