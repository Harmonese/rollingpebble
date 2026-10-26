from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from rollingpebble.auto_timing.contracts import BatchRequest, DraftUpdate, Options, RunRequest
from rollingpebble.auto_timing.protocol import EventStream, ProtocolError, compatible, plain_inventory
from rollingpebble.auto_timing.service import AutoTimingService
from rollingpebble.auto_timing.store import RunStore, now
from rollingpebble.config import Settings
from rollingpebble.jobs import JobManager
from rollingpebble.main import create_app
from rollingpebble.models import ProjectModel
from rollingpebble.paths import StorageLayout
from rollingpebble.runtime.manager import RuntimeManager
from rollingpebble.runtime.reports import protocol_status_ok
from rollingpebble.services.project_service import ProjectService
from rollingpebble.storage.files import write_project


def event(sequence, kind, **fields):
    return json.dumps(dict(protocol_version=2, engine="py-roller", engine_version="0.10.3",
                           request_id="test", sequence=sequence, type=kind, **fields))


def line(start=0, text="Come on", occurrence="occ-1"):
    return dict(occurrence_id=occurrence, line_id="line-1", text=text, start=start, end=start + 1,
                status="needs_review", finalized=True)


def finish_fixture(tmp_path, lines=None):
    lines = [line()] if lines is None else lines
    stream = EventStream("test")
    stream.accept(event(1, "started"))
    stream.accept(event(2, "snapshot", revision=1, final=True, audio_available_until=20, lines=lines))
    artifacts = {}
    for name in ("lrc", "alignment", "diagnostics", "run", "events"):
        path = tmp_path / name
        path.write_text("", encoding="utf-8")
        artifacts[name] = str(path.resolve())
    alignment = dict(protocol_version=2, engine="py-roller", engine_version="0.10.3", request_id="test",
                     status="complete", duration=20, lines=lines)
    Path(artifacts["alignment"]).write_text(json.dumps(alignment), encoding="utf-8")
    Path(artifacts["lrc"]).write_text("".join(f'[00:00.00] {row["text"]}\n' for row in lines), encoding="utf-8")
    stream.accept(event(3, "completed", revision=1, artifacts=artifacts, summary={}, metrics={}))
    return stream, artifacts


@pytest.mark.parametrize("version,expected", [("0.9.9", False), ("0.10.0", False), ("0.10.1", False), ("0.10.2", False), ("0.10.3", True), ("0.10.32", True), ("0.11.0", False)])
def test_version_gate(version, expected):
    assert compatible(version) is expected


def test_revision_replaces_and_can_retract_all_lines():
    stream = EventStream("test")
    stream.accept(event(1, "started"))
    raw = event(2, "snapshot", revision=1, final=False, audio_available_until=10, lines=[line()])
    stream.accept(raw)
    assert stream.accept(raw) is None
    stream.accept(event(3, "snapshot", revision=2, final=True, audio_available_until=20, lines=[]))
    assert stream.snapshot["lines"] == []


def test_unknown_stage_and_stage_clock_reset():
    stream = EventStream("test")
    stream.accept(event(1, "started"))
    stream.accept(event(2, "progress", stage="ctc", audio_available_until=100))
    stream.accept(event(3, "progress", stage="future-stage", audio_available_until=1))
    assert stream.progress["audio_available_until"] == 1


@pytest.mark.parametrize("raw", ["broken", '{"x":1,"x":2}', '{"x":NaN}', event(1, "snapshot", revision=1, final=True, lines=[]), event(2, "started")])
def test_invalid_events_fail_closed(raw):
    with pytest.raises(ProtocolError):
        EventStream("test").accept(raw)


def test_foreign_start_failure_is_process_diagnostic():
    stream = EventStream("test")
    stream.accept(event(1, "started").replace('"test"', '"generated"'))
    with pytest.raises(ProtocolError, match="invalid request"):
        stream.accept(event(2, "failed", code="invalid_request", message="invalid request").replace('"test"', '"generated"'))
    assert stream.snapshot is None


def test_terminal_and_exit_must_agree(tmp_path):
    stream, _ = finish_fixture(tmp_path)
    assert stream.finish(0, tmp_path)["lines"][0]["start"] == 0
    with pytest.raises(ProtocolError):
        stream.finish(1, tmp_path)
    with pytest.raises(ProtocolError):
        stream.accept(event(4, "failed", code="io", message="late error"))


def test_empty_success_is_legal(tmp_path):
    stream, _ = finish_fixture(tmp_path, [])
    assert stream.finish(0, tmp_path)["lines"] == []


@pytest.mark.parametrize("mutation", ["identity", "duration", "lines", "escape", "missing", "lrc"])
def test_artifacts_are_validated(tmp_path, mutation):
    stream, paths = finish_fixture(tmp_path)
    path = Path(paths["alignment"])
    value = json.loads(path.read_text())
    if mutation == "identity":
        value["request_id"] = "other"
    elif mutation == "duration":
        value["duration"] = .5
    elif mutation == "lines":
        value["lines"] = []
    elif mutation == "escape":
        stream.terminal["artifacts"]["lrc"] = str(tmp_path.parent / "elsewhere")
    elif mutation == "lrc":
        Path(paths["lrc"]).write_text("[00:01.00] Wrong text\n")
    else:
        Path(paths["lrc"]).unlink()
    path.write_text(json.dumps(value))
    with pytest.raises(ProtocolError):
        stream.finish(0, tmp_path)


def test_inventory_copy_preserves_unicode():
    text = "[ti:Song]\n[Verse]\n[00:01.00]Come on\nCome on"
    assert plain_inventory(text) == "Come on\nCome on\n"
    assert plain_inventory("Hello\n你好") == "Hello\n你好\n"
    with pytest.raises(ValueError):
        Options(cpu_threads=True)
    with pytest.raises(ValueError):
        Options(language="unknown")


def make_record(store, status="running"):
    record = dict(id="a" * 32, project_id="p1", kind="run", status=status, created_at=now(),
                  snapshot={"revision": 3}, applied=[])
    folder = store.create(record)
    return record, folder


def test_draft_conflict_recovery_and_restart(tmp_path):
    store = RunStore(tmp_path)
    record, folder = make_record(store)
    (folder / "audio.snapshot").write_bytes(b"temporary")
    update = DraftUpdate(version=0, base_revision=2, lines=[dict(id="row", text="Edited", time=0)])
    assert store.save_draft(record["id"], update)["version"] == 1
    with pytest.raises(FileExistsError):
        store.save_draft(record["id"], update)
    recovered = RunStore(tmp_path)
    assert recovered.get(record["id"])["status"] == "interrupted"
    assert recovered.draft(record["id"])["lines"][0]["text"] == "Edited"
    assert not (folder / "audio.snapshot").exists()


def test_duplicate_draft_ids_rejected(tmp_path):
    store = RunStore(tmp_path)
    record, _ = make_record(store)
    with pytest.raises(ValueError, match="Duplicate"):
        store.save_draft(record["id"], DraftUpdate(version=0, base_revision=1,
            lines=[dict(id="same", text="a"), dict(id="same", text="b")]))


def service_fixture(tmp_path):
    layout = StorageLayout.from_data_dir(tmp_path).ensure()
    project = ProjectModel(project_id="p1", audio_name="audio.wav", audio_ref="audio.wav")
    write_project(layout.projects_root, project)
    (layout.projects_root / "p1" / "audio.wav").write_bytes(b"test audio")
    (layout.projects_root / "p1" / "plain.txt").write_text("Come on")
    projects = ProjectService(layout.projects_root)
    manager = RuntimeManager(layout)
    manager.python_path("auto").parent.mkdir(parents=True, exist_ok=True)
    manager.python_path("auto").write_text("")
    manager.update_metadata("auto", {"pyroller_version": "0.10.3", "doctor_report": {
        "protocol_version": 2, "type": "doctor", "runtime_ok": True, "ready": False,
    }})
    runtime = SimpleNamespace(manager=manager, models=SimpleNamespace(require_many=lambda options: None), get_settings=lambda: SimpleNamespace(auto_roller_profile="auto"))
    service = AutoTimingService(projects=projects, runtime=runtime, jobs=JobManager(work_root=layout.work_root))
    def checked(request, **kwargs):
        import hashlib
        from rollingpebble.auto_timing.languages import engine_options
        _, text, identity = service._input(request)
        options, _, _ = service._context(request)
        language = request.options.language if request.options.language != "auto" else "en"
        return {"audio_identity": identity, "lyrics_hash": hashlib.sha256(text.encode()).hexdigest(),
                "language": language, "engine_options": engine_options(options, language)}
    service.preflight = checked
    return service, layout


def test_runtime_ready_is_separate_from_model_ready(tmp_path):
    service, _ = service_fixture(tmp_path)
    assert service.runtime.manager.inspect("auto").ready
    assert protocol_status_ok({"protocol_version": 2, "type": "doctor", "runtime_ok": True, "ready": False})


def test_snapshot_inputs_never_write_project(tmp_path):
    service, layout = service_fixture(tmp_path)
    folder = layout.projects_root / "p1"
    before = {p.name: p.read_bytes() for p in folder.iterdir()}
    record, _ = service._record(RunRequest(project_id="p1"))
    work = service.store.folder(record["id"])
    request = json.loads((work / "request.json").read_text())
    assert not Path(request["output"]).exists()
    assert Path(request["audio"]).read_bytes() == before["audio.wav"]
    assert {p.name: p.read_bytes() for p in folder.iterdir()} == before
    assert record["options"]["offline"] is True


def test_untracked_audio_is_not_inferred(tmp_path):
    service, layout = service_fixture(tmp_path)
    write_project(layout.projects_root, ProjectModel(project_id="p1"))
    with pytest.raises(ValueError, match="no audio"):
        service._input(RunRequest(project_id="p1"))


def test_input_version_mismatch(tmp_path):
    service, _ = service_fixture(tmp_path)
    with pytest.raises(ValueError, match="lyrics changed"):
        service._input(RunRequest(project_id="p1", expected_lyrics="Different"))


def test_stderr_drained_and_missing_terminal_fails(tmp_path):
    service, _ = service_fixture(tmp_path)
    record, _ = service._record(RunRequest(project_id="p1"))
    record["command"] = [sys.executable, "-c", "import sys; sys.stderr.write('x'*200000); print('broken')"]
    service._execute(record, None)
    assert service.store.get(record["id"])["status"] == "failed"
    folder = service.store.folder(record["id"])
    assert (folder / "stderr.log").stat().st_size == 200000
    assert not (folder / "audio.snapshot").exists()


def test_cancel_keeps_resource_until_exit(tmp_path, monkeypatch):
    service, _ = service_fixture(tmp_path)
    original = service._record
    def slow(request, **kwargs):
        record, env = original(request, **kwargs)
        command = [sys.executable, "-c", "import signal,time; signal.signal(signal.SIGTERM, lambda *a: (time.sleep(.2), exit(130))); time.sleep(60)"]
        record = service.store.update(record["id"], command=command)
        return record, env
    monkeypatch.setattr(service, "_record", slow)
    record = service.start(RunRequest(project_id="p1"))
    deadline = time.monotonic() + 5
    while record["id"] not in service._processes and time.monotonic() < deadline:
        time.sleep(.01)
    time.sleep(.1)
    assert service.cancel(record["id"])["status"] == "cancelling"
    assert service.jobs.resource_lock.locked()
    while service.jobs.resource_lock.locked() and time.monotonic() < deadline:
        time.sleep(.01)
    assert service.store.get(record["id"])["status"] == "cancelled"
    assert not service.jobs.resource_lock.locked()


def test_batch_serial_failure_continues(tmp_path, monkeypatch):
    service, layout = service_fixture(tmp_path)
    for pid in ("p2", "p3"):
        write_project(layout.projects_root, ProjectModel(project_id=pid, audio_name="audio.wav", audio_ref="audio.wav"))
        (layout.projects_root / pid / "audio.wav").write_bytes(b"audio")
        (layout.projects_root / pid / "plain.txt").write_text("Come on")
    order = []
    executing = threading.Lock()
    def execute(record, env):
        assert executing.acquire(blocking=False)
        order.append(record["project_id"])
        service.store.update(record["id"], status="failed" if record["project_id"] == "p2" else "completed")
        executing.release()
    monkeypatch.setattr(service, "_execute", execute)
    batch = service.batch(BatchRequest(project_ids=["p1", "p2", "p3"]))
    deadline = time.monotonic() + 5
    while service.jobs.resource_lock.locked() and time.monotonic() < deadline:
        time.sleep(.01)
    assert order == ["p1", "p2", "p3"]
    assert service.store.get(batch["id"])["status"] == "failed"


def test_legacy_routes_explicitly_gone(tmp_path):
    client = TestClient(create_app(Settings(data_dir=tmp_path)))
    assert client.post("/api/projects/p1/roll", json={"language": "zh"}).status_code == 410
    assert client.post("/api/batch/roll", json={}).status_code == 410
    assert client.get("/api/auto-timing/runs").json() == []


def test_corrupt_run_does_not_break_history(tmp_path):
    store = RunStore(tmp_path)
    record, folder = make_record(store, "completed")
    (folder / "record.json").write_text("broken")
    assert RunStore(tmp_path).list() == []


@pytest.mark.parametrize("failure", ["directory", "prepare", "thread"])
def test_runtime_job_start_failure_releases_lock(tmp_path, monkeypatch, failure):
    jobs = JobManager(work_root=tmp_path)
    cleaned = []
    def prepare(*args):
        if failure == "prepare":
            raise OSError("disk full")
        return [sys.executable, "-V"], None, None, lambda: cleaned.append(True)
    def fail(*args, **kwargs):
        raise OSError("start failure")
    if failure == "directory":
        monkeypatch.setattr(jobs, "_job_work_dir", fail)
    if failure == "thread":
        monkeypatch.setattr(threading.Thread, "start", fail)
    with pytest.raises(OSError):
        jobs.create_subprocess_job(kind="test", project_id=None, command=[], cwd=None, prepare=prepare)
    assert not jobs.resource_lock.locked()
    assert cleaned == ([True] if failure == "thread" else [])


def test_input_disk_failure_retains_failure_record_and_releases_lock(tmp_path, monkeypatch):
    service, _ = service_fixture(tmp_path)
    original = Path.write_text
    def fail(path, *args, **kwargs):
        if path.name == "lyrics.txt":
            raise OSError("disk full")
        return original(path, *args, **kwargs)
    monkeypatch.setattr(Path, "write_text", fail)
    with pytest.raises(OSError, match="disk full"):
        service.start(RunRequest(project_id="p1"))
    assert not service.jobs.resource_lock.locked()
    records = service.store.list()
    assert records[0]["status"] == "failed"
    assert not (service.store.folder(records[0]["id"]) / "audio.snapshot").exists()


def test_batch_cancel_stops_pending_and_holds_resources(tmp_path, monkeypatch):
    service, layout = service_fixture(tmp_path)
    write_project(layout.projects_root, ProjectModel(project_id="p2", audio_name="audio.wav", audio_ref="audio.wav"))
    (layout.projects_root / "p2" / "audio.wav").write_bytes(b"audio")
    (layout.projects_root / "p2" / "plain.txt").write_text("Come on")
    entered, release = threading.Event(), threading.Event()
    order = []
    def execute(record, env):
        order.append(record["project_id"])
        entered.set()
        assert release.wait(5)
        service.store.update(record["id"], status="cancelled")
    monkeypatch.setattr(service, "_execute", execute)
    parent = service.batch(BatchRequest(project_ids=["p1", "p2"]))
    assert entered.wait(5)
    service.cancel(parent["id"])
    assert service.jobs.resource_lock.locked()
    release.set()
    deadline = time.monotonic() + 5
    while service.jobs.resource_lock.locked() and time.monotonic() < deadline:
        time.sleep(.01)
    assert order == ["p1"]
    assert service.store.get(parent["id"])["status"] == "cancelled"
    assert all(service.store.get(rid)["status"] == "cancelled" for rid in parent["children"])


def test_legacy_settings_backup_and_new_defaults(tmp_path):
    from rollingpebble.storage.app_settings import SettingsStore
    legacy = dict(auto_roller_profile="cu124", auto_timing_default_language="zh",
                  auto_timing_model_store="/external/models", auto_timing_hf_proxy="http://localhost:1234",
                  recent_projects_limit=3)
    (tmp_path / "settings.json").write_text(json.dumps(legacy))
    from rollingpebble.storage.transition import begin_layout_transition
    begin_layout_transition(tmp_path)
    settings = SettingsStore(tmp_path).read()
    assert settings.auto_roller_profile == "auto"
    assert not hasattr(settings, "auto_timing_legacy_models")
    assert settings.auto_timing_hf_proxy == legacy["auto_timing_hf_proxy"]
    assert settings.recent_projects_limit == 3
    assert Options(**settings.auto_timing_v2_options).audio_mode == "mix"
    assert not (tmp_path / "settings.pre-protocol-v2.json").exists()


def test_engine_migration_rejects_project_storage(tmp_path):
    client = TestClient(create_app(Settings(data_dir=tmp_path)))
    response = client.post("/api/storage/relocate", json={"path": str(tmp_path / "projects" / "engine")})
    assert response.status_code == 400
    assert not (tmp_path / "projects" / "engine").exists()


def test_doctor_missing_models_does_not_fail_runtime_job(tmp_path):
    from rollingpebble import job_kinds
    jobs = JobManager(work_root=tmp_path)
    report = dict(protocol_version=2, type="doctor", engine="py-roller", runtime_ok=True, ready=False)
    command = [sys.executable, "-c", f"print({json.dumps(report)!r}); raise SystemExit(1)"]
    job = jobs.create_subprocess_job(kind=job_kinds.RUNTIME_DOCTOR, project_id=None, command=command, cwd=None)
    deadline = time.monotonic() + 5
    while jobs.resource_lock.locked() and time.monotonic() < deadline:
        time.sleep(.01)
    assert jobs.get(job.job_id).status.value == "succeeded"
    assert jobs.get(job.job_id).return_code == 1


def test_rejected_batch_keeps_parent_and_releases_snapshots(tmp_path, monkeypatch):
    service, _ = service_fixture(tmp_path)
    with pytest.raises(FileNotFoundError):
        service.batch(BatchRequest(project_ids=["p1", "missing"]))
    assert not service.jobs.resource_lock.locked()
    assert not service.store.list()


def completed_batch_fixture(service):
    parent = dict(id="b" * 32, project_id=None, kind="batch", status="completed", created_at=now(),
                  children=["c" * 32, "d" * 32])
    service.store.create(parent)
    for child in parent["children"]:
        folder = service.store.create(dict(id=child, project_id="p1", kind="run", status="completed",
                                          created_at=now(), batch_id=parent["id"]))
        (folder / "draft.json").write_text('{"version": 1}')
        (folder / "stderr.log").write_text("log")
    return parent


def test_delete_batch_preserves_project_and_other_results(tmp_path):
    service, layout = service_fixture(tmp_path)
    parent = completed_batch_fixture(service)
    other, _ = make_record(service.store, "completed")
    project_folder = layout.projects_root / "p1"
    before = {path.name: path.read_bytes() for path in project_folder.iterdir()}
    result = service.delete_results(parent["id"], kind="batch")
    assert result["deleted"] is True
    assert set(result["deleted_ids"]) == {parent["id"], *parent["children"]}
    assert [record["id"] for record in service.store.list()] == [other["id"]]
    assert {path.name: path.read_bytes() for path in project_folder.iterdir()} == before
    assert not service.jobs.resource_lock.locked()


def test_delete_last_child_reports_removed_parent(tmp_path):
    service, _ = service_fixture(tmp_path)
    parent = completed_batch_fixture(service)
    first, last = parent["children"]
    assert service.delete_results(first, kind="run")["deleted_ids"] == [first]
    assert service.store.get(parent["id"])["children"] == [last]
    assert service.delete_results(last, kind="run")["deleted_ids"] == [last, parent["id"]]
    assert service.store.list() == []


@pytest.mark.parametrize("active_target", ["parent", "child", "resources"])
def test_delete_rejects_active_batch_without_partial_removal(tmp_path, active_target):
    service, _ = service_fixture(tmp_path)
    parent = completed_batch_fixture(service)
    if active_target == "resources":
        service.jobs.resource_lock.acquire()
    else:
        service.store.update(parent["id"] if active_target == "parent" else parent["children"][1], status="running")
    try:
        with pytest.raises(ValueError):
            service.delete_results(parent["id"], kind="batch")
        assert len(service.store.list()) == 3
    finally:
        if active_target == "resources":
            service.jobs.resource_lock.release()
    assert not service.jobs.resource_lock.locked()


def test_batch_delete_routes_and_kind_validation(tmp_path):
    app = create_app(Settings(data_dir=tmp_path))
    client = TestClient(app)
    # Discover the same store through its layout, without starting the runtime.
    store = RunStore(StorageLayout.from_data_dir(tmp_path).results_root)
    service = SimpleNamespace(store=store)
    parent = completed_batch_fixture(service)
    assert client.delete(f'/api/auto-timing/runs/{parent["id"]}').status_code == 400
    result = client.delete(f'/api/auto-timing/batches/{parent["id"]}')
    assert result.status_code == 200
    assert set(result.json()["deleted_ids"]) == {parent["id"], *parent["children"]}
    assert client.delete(f'/api/auto-timing/batches/{parent["id"]}').status_code == 404


@pytest.mark.parametrize("change", ["audio", "lyrics", "options", "legacy", "active", "preflight_race"])
def test_retry_rejects_changed_inputs_and_releases_admission(tmp_path, monkeypatch, change):
    from rollingpebble.auto_timing.contracts import Options
    from rollingpebble.messages import AppError
    service, layout = service_fixture(tmp_path)
    request = RunRequest(project_id="p1")
    old, _ = service._record(request)
    service.store.update(old["id"], status="failed")
    if change == "audio":
        (layout.projects_root / "p1" / "audio.wav").write_bytes(b"replacement")
    elif change == "lyrics":
        (layout.projects_root / "p1" / "plain.txt").write_text("Changed lyrics")
    elif change == "options":
        request.options = Options(language="mul")
    elif change == "legacy":
        service.store.update(old["id"], lyrics_hash=None)
    elif change == "active":
        service.store.update(old["id"], status="running")
    elif change == "preflight_race":
        original = service.preflight
        def changed(request, **kwargs):
            (layout.projects_root / "p1" / "plain.txt").write_text("Changed during admission")
            return original(request, **kwargs)
        monkeypatch.setattr(service, "preflight", changed)
    with pytest.raises(AppError) as caught:
        service.start(request, retry_of=old["id"])
    assert caught.value.message.code == "timing.retry_input_changed"
    assert len(service.store.list()) == 1
    assert not service.jobs.resource_lock.locked()
