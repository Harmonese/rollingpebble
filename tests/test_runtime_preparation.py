from types import SimpleNamespace
import threading

import pytest
from pydantic import ValidationError

from rollingpebble.runtime.preparation import EnsureRequest, RuntimePreparation


class FakeManager:
    def __init__(self, root):
        self.layout = SimpleNamespace(runtime_root=root)
        self.metadata = {}
        self.python = root / "python"
        self.python.touch()

    def python_path(self, profile):
        return self.python

    def install_command(self, profile):
        return ["installer"]

    def _read_runtime_metadata(self, profile):
        return self.metadata


class FakeJobs:
    def __init__(self, manager):
        self.manager = manager
        self.jobs = []
        self.resource_lock = threading.Lock()

    def create_subprocess_job(self, **kwargs):
        if not self.resource_lock.acquire(False):
            raise RuntimeError("Auto Timing resources are busy")
        job = SimpleNamespace(job_id=str(len(self.jobs)), command=kwargs["command"],
                              status="running", done=threading.Event())
        self.jobs.append(job)
        return job

    def wait(self, job_id):
        assert self.jobs[int(job_id)].done.wait(3)

    def get(self, job_id):
        return self.jobs[int(job_id)]

    def finish(self, status="succeeded"):
        job = self.jobs[-1]
        job.status = status
        if status == "succeeded":
            self.manager.metadata["prepared_capabilities"] = ["original"] + (["vocals"] if "--vocals" in job.command else [])
        self.resource_lock.release()
        job.done.set()

    def cancel(self, job_id):
        self.finish("canceled")


@pytest.fixture
def preparation(tmp_path, monkeypatch):
    monkeypatch.setattr("rollingpebble.runtime.preparation.bundle_fingerprint", lambda: "bundle-a")
    manager = FakeManager(tmp_path)
    jobs = FakeJobs(manager)
    service = RuntimePreparation(manager, jobs)
    yield service, jobs
    service.close()


def finish(service, jobs, status="succeeded"):
    jobs.finish(status)
    service.thread.join(2)
    assert not service.thread.is_alive()


def test_lazy_deduplication_and_reuse(preparation):
    service, jobs = preparation
    assert not jobs.jobs
    first = service.ensure(EnsureRequest())
    assert first["status"] == "checking"
    assert service.ensure(EnsureRequest())["job_id"] == first["job_id"]
    finish(service, jobs)
    assert service.ensure(EnsureRequest())["status"] == "ready"
    assert len(jobs.jobs) == 1


def test_vocals_escalates_after_base_exit(preparation):
    service, jobs = preparation
    service.ensure(EnsureRequest())
    service.ensure(EnsureRequest(capability="vocals"))
    assert len(jobs.jobs) == 1
    created = threading.Event()
    original = jobs.create_subprocess_job
    def create(**kwargs):
        job = original(**kwargs)
        created.set()
        return job
    jobs.create_subprocess_job = create
    jobs.finish()
    assert created.wait(2)
    assert "--vocals" in jobs.jobs[-1].command
    finish(service, jobs)
    assert service.snapshot()["capabilities"] == ["original", "vocals"]


def test_failure_requires_explicit_retry(preparation):
    service, jobs = preparation
    service.ensure(EnsureRequest())
    finish(service, jobs, "failed")
    assert service.ensure(EnsureRequest())["status"] == "failed"
    assert len(jobs.jobs) == 1
    service.ensure(EnsureRequest(repair=True))
    assert "--repair" in jobs.jobs[-1].command
    finish(service, jobs)


def test_live_phase_tracks_installation_and_checks(preparation):
    service, jobs = preparation
    assert service.ensure(EnsureRequest())["status"] == "checking"
    service.manager.metadata["preparation_phase"] = "preparing"
    assert service.ensure(EnsureRequest())["status"] == "preparing"
    service.manager.metadata["preparation_phase"] = "checking"
    assert service.ensure(EnsureRequest())["status"] == "checking"
    assert len(jobs.jobs) == 1
    finish(service, jobs)


def test_bundle_change_and_environment_removal_recheck(preparation, monkeypatch):
    service, jobs = preparation
    service.ensure(EnsureRequest())
    finish(service, jobs)
    monkeypatch.setattr("rollingpebble.runtime.preparation.bundle_fingerprint", lambda: "bundle-b")
    service.ensure(EnsureRequest())
    finish(service, jobs)
    service.manager.python.unlink()
    service.ensure(EnsureRequest())
    finish(service, jobs)
    assert len(jobs.jobs) == 3


def test_busy_resource_does_not_enqueue(preparation):
    service, jobs = preparation
    jobs.resource_lock.acquire()
    try:
        with pytest.raises(RuntimeError, match="resources are busy"):
            service.ensure(EnsureRequest())
        assert not jobs.jobs
    finally:
        jobs.resource_lock.release()


def test_close_waits_and_does_not_escalate(preparation):
    service, jobs = preparation
    service.ensure(EnsureRequest())
    service.ensure(EnsureRequest(capability="vocals"))
    service.close()
    assert service.snapshot()["status"] == "failed"
    assert len(jobs.jobs) == 1
    assert not jobs.resource_lock.locked()


def test_new_session_checks_existing_environment(preparation):
    service, jobs = preparation
    service.ensure(EnsureRequest())
    finish(service, jobs)
    fresh = RuntimePreparation(service.manager, jobs)
    fresh.ensure(EnsureRequest())
    finish(fresh, jobs)
    assert len(jobs.jobs) == 2


@pytest.mark.parametrize("field", ["command", "version", "profile", "path", "skip_doctor"])
def test_request_has_no_installation_controls(field):
    with pytest.raises(ValidationError):
        EnsureRequest.model_validate({field: "anything"})


def test_missing_bundle_does_not_use_system_python(tmp_path, monkeypatch):
    from rollingpebble.runtime.installer import install_runtime
    monkeypatch.setenv("ROLLINGPEBBLE_APP_RESOURCES", str(tmp_path / "missing"))
    with pytest.raises(RuntimeError, match="wheels are missing"):
        install_runtime(tmp_path)


def test_missing_bundled_python_does_not_fall_back(tmp_path, monkeypatch):
    from rollingpebble.runtime.installer import install_runtime
    monkeypatch.setattr("rollingpebble.runtime.installer.bundle_fingerprint", lambda: "bundle")
    monkeypatch.setattr("rollingpebble.runtime.installer.prepare_bundled_runtime", lambda path: None)
    with pytest.raises(RuntimeError, match="Bundled Python is missing"):
        install_runtime(tmp_path)


def test_deprecated_installation_routes(tmp_path):
    from fastapi.testclient import TestClient
    from rollingpebble.config import Settings
    from rollingpebble.main import create_app
    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        for route in ["runtime/auto-roller/install", "runtime/auto-roller/upgrade",
                      "runtime/auto-roller/doctor", "auto-timing/vocals/install"]:
            response = client.post("/api/" + route, json={"profile": "auto"})
            assert response.status_code in {404, 405}


def test_startup_preparation_flag_does_not_install(tmp_path, monkeypatch):
    from rollingpebble.jobs import JobManager
    from rollingpebble.runtime.service import RuntimeService
    jobs = JobManager(work_root=tmp_path / "work")
    service = RuntimeService(data_dir=tmp_path, jobs=jobs)
    monkeypatch.delenv("ROLLINGPEBBLE_APP_RESOURCES", raising=False)
    assert service.get_auto_roller_runtime().startup_preparation is False
    monkeypatch.setenv("ROLLINGPEBBLE_APP_RESOURCES", str(tmp_path / "resources"))
    assert service.get_auto_roller_runtime().startup_preparation is True
    assert jobs.list() == []


@pytest.mark.parametrize("repair,interrupted,expected_install", [(False, False, False), (True, False, True), (False, True, True)])
def test_installer_reuses_or_rebuilds_without_models(tmp_path, monkeypatch, repair, interrupted, expected_install):
    import json
    from rollingpebble.runtime import installer
    from rollingpebble.paths import ensure_storage_layout
    from rollingpebble.storage.app_settings import SettingsStore
    layout = ensure_storage_layout(tmp_path, SettingsStore(tmp_path).read())
    root = layout.runtime_root
    executable = root / "venv" / "bin" / "python"
    executable.parent.mkdir(parents=True)
    executable.touch()
    sentinel = executable.parent / "old-broken-file"
    sentinel.touch()
    (root / "runtime.json").write_text(json.dumps({
        "bundle_fingerprint": "bundle", "prepared_capabilities": ["original"],
        "last_install_status": "running" if interrupted else "ok",
    }))
    resources = tmp_path / "resources"
    resources.mkdir()
    (resources / "requirements.txt").write_text("py-roller==0.10.3\n")
    monkeypatch.setattr(installer, "engine_resources", lambda: resources)
    monkeypatch.setattr(installer, "bundle_fingerprint", lambda: "bundle")
    monkeypatch.setattr(installer, "prepare_bundled_runtime", lambda path: tmp_path / "bundled-python")
    monkeypatch.setattr(installer, "runtime_python_path", lambda path: path / "bin" / "python")
    monkeypatch.setattr(installer, "build_runtime_env", lambda *args: {})
    calls = []
    def run(command, **kwargs):
        calls.append(command)
        if "venv" in command:
            executable.parent.mkdir(parents=True)
            executable.touch()
        report = {"runtime_ok": True, "ready": False, "engine_version": "0.10.3",
                  "capabilities": {"protocol_versions": [2]}}
        return SimpleNamespace(returncode=1 if "doctor" in command else 0, stdout=json.dumps(report))
    monkeypatch.setattr(installer.subprocess, "run", run)
    installer.install_runtime(tmp_path, ensure=True, repair=repair)
    installs = [c for c in calls if "install" in c]
    assert bool(installs) == expected_install
    if installs:
        assert "--no-index" in installs[0] and "--require-hashes" in installs[0]
        assert not sentinel.exists()
    assert all("download" not in c for c in calls)
    metadata = json.loads((root / "runtime.json").read_text())
    assert metadata["last_install_status"] == "ok"
    assert metadata["doctor_report"]["ready"] is False
    assert metadata["prepared_capabilities"] == ["multilingual", "original"]


def test_multilingual_failure_does_not_disable_base(preparation):
    service, jobs = preparation
    service.ensure(EnsureRequest(multilingual=True))
    finish(service, jobs)
    assert service.snapshot()['status'] == 'failed'
    assert service.snapshot()['error'] == 'runtime.multilingual_failed'
    assert service.ensure(EnsureRequest())['status'] == 'ready'
    assert service.ensure(EnsureRequest(multilingual=True))['status'] == 'failed'
    assert len(jobs.jobs) == 1
