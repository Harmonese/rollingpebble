import hashlib
import io
import json
import threading
from dataclasses import replace

import pytest

from rollingpebble.auto_timing.contracts import BatchRequest, ModelAction, Options, RunRequest
from rollingpebble.auto_timing.model_catalog import CATALOG, ModelFile, ModelSpec
from rollingpebble.auto_timing.model_download import download_file, download_opener, validate_proxy
from rollingpebble.auto_timing.model_service import ModelService
from rollingpebble.jobs import JobManager
from rollingpebble.messages import AppError
from rollingpebble.models import RuntimeSettingsUpdateRequest
from rollingpebble.paths import StorageLayout
from rollingpebble.runtime.service import RuntimeService
from rollingpebble.storage.app_settings import SettingsStore


PAYLOAD = b"small model fixture\n" * 100


class Response(io.BytesIO):
    def __init__(self, body, status=200, headers=None):
        super().__init__(body)
        self.status = status
        self.headers = headers or {"Content-Length": str(len(body))}


class Opener:
    def __init__(self, behavior="range"):
        self.behavior = behavior
        self.requests = []

    def open(self, request, **kwargs):
        offset = int(request.headers.get("Range", "bytes=0-")[6:-1])
        self.requests.append((request.full_url, offset))
        if self.behavior == "error":
            raise OSError("http://user:secret@proxy failed")
        if self.behavior == "timeout":
            raise TimeoutError()
        if self.behavior == "disk":
            raise OSError(28, "full")
        if self.behavior == "hash":
            return Response(b"x" * len(PAYLOAD))
        if offset and self.behavior != "ignore":
            start = offset + 1 if self.behavior == "bad-range" else offset
            return Response(PAYLOAD[offset:], 206, {"Content-Range": f"bytes {start}-{len(PAYLOAD)-1}/{len(PAYLOAD)}"})
        return Response(PAYLOAD)


@pytest.fixture
def service(tmp_path, monkeypatch):
    layout = StorageLayout.from_data_dir(tmp_path)
    jobs = JobManager(work_root=layout.work_root)
    runtime = RuntimeService(layout=layout, jobs=jobs)
    runtime.settings.write(runtime.get_settings())
    file = ModelFile("weight.bin", len(PAYLOAD), hashlib.sha256(PAYLOAD).hexdigest())
    catalog = {kind: ModelSpec(kind, "fixed", "Harmonese/" + kind, "pinned", "official/" + kind, (file,))
               for kind in CATALOG}
    result = ModelService(runtime, jobs, catalog)
    opener = Opener()
    monkeypatch.setattr("rollingpebble.auto_timing.model_service.download_opener", lambda proxy: opener)
    yield result, opener
    result.close()


def run(service, action, kinds=None, **kwargs):
    job = service.start(ModelAction(action=action, kinds=kinds, **kwargs))
    service.jobs.wait(job.job_id)
    return service.jobs.get(job.job_id)


def statuses(service):
    return {row["kind"]: row["status"] for row in service.snapshot()["models"]}


def test_settings_fresh_upgrade_skip_and_reset(tmp_path):
    store = SettingsStore(tmp_path)
    fresh = store.read()
    assert not fresh.model_onboarding_complete
    assert fresh.model_download_source == "modelscope"
    store.write(fresh)
    assert not store.read().model_onboarding_complete
    fresh.model_onboarding_complete = True
    store.write(fresh)
    assert store.reset_defaults().model_onboarding_complete
    store.path.write_text(json.dumps({"auto_timing_hf_proxy": "http://localhost:7890"}))
    assert store.read().model_onboarding_complete
    assert store.read().model_proxy_enabled


def test_download_verify_reuse_restart_and_missing(service):
    models, opener = service
    assert set(statuses(models).values()) == {"missing"}
    assert run(models, "download").status == "succeeded"
    assert len(opener.requests) == len(CATALOG)
    assert set(statuses(models).values()) == {"ready"}
    assert run(models, "download").status == "succeeded"
    assert len(opener.requests) == len(CATALOG)
    models.require(Options(language="en", audio_mode="vocals").model_dump())
    restarted = ModelService(models.runtime, models.jobs, models.catalog)
    assert set(statuses(restarted).values()) == {"unverified"}
    with pytest.raises(AppError):
        restarted.require(Options(language="en").model_dump())
    first = run(restarted, "verify", startup=True)
    assert first.status == "succeeded"
    assert run(restarted, "verify", startup=True).job_id != first.job_id
    (restarted._target("demucs") / "weight.bin").unlink()
    assert statuses(restarted)["demucs"] == "missing"
    run(restarted, "verify", ["demucs"])
    assert statuses(restarted)["demucs"] == "missing"
    restarted.require(Options(language="en").model_dump())
    with pytest.raises(AppError):
        restarted.require(Options(language="en", audio_mode="vocals").model_dump())


def test_individual_repair_preserves_others_and_delete(service):
    models, opener = service
    run(models, "download")
    untouched = models._target("ctc") / "weight.bin"
    old_stat = untouched.stat()
    (models._target("whisper") / "weight.bin").write_bytes(b"x" * len(PAYLOAD))
    run(models, "verify")
    assert statuses(models)["whisper"] == "corrupt"
    assert run(models, "repair", ["whisper"]).status == "succeeded"
    assert len(opener.requests) == len(CATALOG) + 1
    assert untouched.stat().st_ino == old_stat.st_ino
    assert run(models, "remove", ["whisper"]).status == "succeeded"
    assert statuses(models)["whisper"] == "missing"
    restarted = ModelService(models.runtime, models.jobs, models.catalog)
    run(restarted, "verify", startup=True)
    assert statuses(restarted)["whisper"] == "missing"
    assert not restarted.snapshot()["models"][0]["repair_needed"]
    assert restarted.snapshot()["startup_issues"] == [dict(
        kind="whisper", origin="managed", status="missing", reason="deleted", action="download")]


def test_failed_repair_keeps_old_target_and_no_credentials(service):
    models, opener = service
    run(models, "download", ["whisper"])
    path = models._target("whisper") / "weight.bin"
    path.write_bytes(b"old damaged model")
    opener.behavior = "error"
    result = run(models, "repair", ["whisper"])
    assert result.status == "failed"
    assert "secret" not in result.model_dump_json()
    assert path.read_bytes() == b"old damaged model"
    assert models.snapshot()["models"][0]["repair_needed"]


def test_cancel_merge_and_exclusion_until_worker_exits(service, monkeypatch):
    models, _ = service
    entered, released = threading.Event(), threading.Event()
    original = models._verify
    def delayed(*args, **kwargs):
        entered.set()
        assert released.wait(3)
        return original(*args, **kwargs)
    monkeypatch.setattr(models, "_verify", delayed)
    job = models.start(ModelAction(action="download", kinds=["whisper"]))
    assert entered.wait(2)
    assert models.start(ModelAction(action="download", kinds=["whisper"])).job_id == job.job_id
    with pytest.raises(RuntimeError, match="busy"):
        models.start(ModelAction(action="download", kinds=["ctc"]))
    assert models.jobs.cancel(job.job_id).status == "cancelling"
    assert models.jobs.resource_lock.locked()
    released.set()
    models.jobs.wait(job.job_id)
    assert models.jobs.get(job.job_id).status == "canceled"
    assert not models.jobs.resource_lock.locked()
    assert not models._target("whisper").exists()


def test_external_paths_do_not_require_fixed_weights(service, tmp_path):
    models, _ = service
    external = tmp_path / "external"
    external.mkdir()
    sentinel = external / "model"
    sentinel.write_bytes(b"leave alone")
    models.require(Options(language="en", whisper_model=str(external), ctc_model=str(external)).model_dump())
    run(models, "remove")
    assert sentinel.read_bytes() == b"leave alone"
    with pytest.raises(AppError):
        models.require(Options(language="en", offline=False).model_dump())


def test_stat_changes_and_manifest_invalidate(service):
    models, _ = service
    run(models, "download")
    path = models._target("ctc") / "weight.bin"
    path.touch()
    assert statuses(models)["ctc"] == "unverified"
    run(models, "verify", ["ctc"])
    assert statuses(models)["ctc"] == "ready"
    spec = models.catalog["ctc"]
    models.catalog["ctc"] = replace(spec, files=(replace(spec.files[0], sha256="0" * 64),))
    assert statuses(models)["ctc"] == "unverified"


def test_interrupted_publish_recovery(service):
    models, _ = service
    run(models, "download", ["ctc"])
    target = models._target("ctc")
    target.rename(target.with_name(target.name + ".previous"))
    restarted = ModelService(models.runtime, models.jobs, models.catalog)
    assert statuses(restarted)["ctc"] == "unverified"
    assert (target / "weight.bin").read_bytes() == PAYLOAD


@pytest.mark.parametrize("mode", ["range", "ignore"])
def test_resume_and_server_ignoring_range(tmp_path, mode):
    file = ModelFile("weights", len(PAYLOAD), hashlib.sha256(PAYLOAD).hexdigest())
    path = tmp_path / "weights"
    path.write_bytes(PAYLOAD[:10])
    opener = Opener(mode)
    progress = []
    download_file(file, "https://example.test/weights", path, opener=opener, cancel=threading.Event(),
                  progress=progress.append, timeout=2)
    assert opener.requests[0][1] == 10
    assert path.read_bytes() == PAYLOAD
    assert progress[-1] == len(PAYLOAD)


@pytest.mark.parametrize("mode,code", [("hash", "models.hash"), ("bad-range", "models.range"),
                                     ("timeout", "models.download_failed"), ("disk", "models.disk_full")])
def test_download_failures(tmp_path, monkeypatch, mode, code):
    file = ModelFile("weights", len(PAYLOAD), hashlib.sha256(PAYLOAD).hexdigest())
    path = tmp_path / "weights"
    path.write_bytes(PAYLOAD[:10])
    opener = Opener(mode)
    monkeypatch.setattr(threading.Event, "wait", lambda self, timeout=None: self.is_set())
    with pytest.raises(AppError) as caught:
        download_file(file, "https://example.test/weights", path, opener=opener, cancel=threading.Event(),
                      progress=lambda n: None, timeout=2)
    assert caught.value.message.code == code
    assert len(opener.requests) <= 3


def test_source_pins_and_proxy_isolation(monkeypatch):
    monkeypatch.setenv("HTTPS_PROXY", "http://invalid:1234")
    monkeypatch.setenv("ALL_PROXY", "socks5://invalid:1234")
    opener = download_opener("")
    assert not any(getattr(handler, "proxies", {}) for handler in opener.handlers)
    for value in ("socks5://localhost:1080", "localhost:7890", "http://", "file:///tmp/a"):
        with pytest.raises(AppError):
            validate_proxy(value)
    validate_proxy("http://user:password@localhost:7890")
    for spec in CATALOG.values():
        assert len(spec.mirror_revision) == 40
        for file in spec.files:
            assert len(file.sha256) == 64
            assert spec.mirror_revision in spec.url(file, "modelscope")
            assert "master" not in spec.url(file, "modelscope")
            if file.inline:
                assert len(file.inline) == file.size
                assert hashlib.sha256(file.inline).hexdigest() == file.sha256
    assert all(not f.name.endswith((".h5", ".msgpack")) for f in CATALOG["ctc"].files)


def test_network_settings_rejected_before_persistence(service):
    models, _ = service
    with pytest.raises(AppError):
        models.runtime.update_settings(RuntimeSettingsUpdateRequest(model_proxy_enabled=True, auto_timing_hf_proxy="socks5://x"))
    assert not models.runtime.get_settings().model_proxy_enabled


def test_full_hash_is_computed_each_process(service, monkeypatch):
    models, _ = service
    run(models, "download")
    from rollingpebble.auto_timing import model_service
    original = model_service.file_digest
    hashed = []
    def track(path, *args, **kwargs):
        hashed.append(path)
        return original(path, *args, **kwargs)
    monkeypatch.setattr(model_service, "file_digest", track)
    restarted = ModelService(models.runtime, models.jobs, models.catalog)
    run(restarted, "verify", startup=True)
    assert len(hashed) == len(CATALOG)
    run(restarted, "verify", startup=True)
    assert len(hashed) == len(CATALOG)


def test_single_and_batch_cannot_bypass_unverified_models(service, monkeypatch):
    from rollingpebble.auto_timing.service import AutoTimingService
    models, _ = service
    models.runtime.models = models
    service = AutoTimingService(projects=None, runtime=models.runtime, jobs=models.jobs)
    monkeypatch.setattr(service, "_input", lambda request: (None, "hello", "audio"))
    monkeypatch.setattr(service, "_context", lambda request: (request.options.model_dump(), ["python"], {}))
    monkeypatch.setattr("rollingpebble.auto_timing.service.resolve_language", lambda *args: "en")
    for method, request in ((service.start, RunRequest(project_id="p", options=Options(offline=False))),
                            (service.batch, BatchRequest(project_ids=["p"], options=Options(offline=False)))):
        with pytest.raises(AppError, match="Verify or download"):
            method(request)
        assert not models.jobs.resource_lock.locked()
    assert not service.store.list()


def test_partial_download_cancel_then_resume(tmp_path):
    file = ModelFile("weights", len(PAYLOAD), hashlib.sha256(PAYLOAD).hexdigest())
    path = tmp_path / "weights"
    cancel = threading.Event()
    from rollingpebble.auto_timing.model_download import ModelCancelled
    class Interrupted(io.BytesIO):
        status = 200
        headers = {"Content-Length": str(len(PAYLOAD))}
        def read(self, size):
            if self.tell():
                cancel.set()
            return super().read(10)
    class InterruptingOpener:
        def open(self, *args, **kwargs):
            return Interrupted(PAYLOAD)
    with pytest.raises(ModelCancelled):
        download_file(file, "https://example.test/weights", path, opener=InterruptingOpener(), cancel=cancel,
                      progress=lambda n: None, timeout=2)
    assert path.read_bytes() == PAYLOAD[:10]
    cancel.clear()
    opener = Opener()
    download_file(file, "https://example.test/weights", path, opener=opener, cancel=cancel,
                  progress=lambda n: None, timeout=2)
    assert opener.requests[0][1] == 10
    assert path.read_bytes() == PAYLOAD


def test_repair_reuses_healthy_files(service):
    models, opener = service
    file = models.catalog["ctc"].files[0]
    models.catalog["ctc"] = replace(models.catalog["ctc"], files=(file, replace(file, name="second.bin")))
    run(models, "download", ["ctc"])
    (models._target("ctc") / "second.bin").unlink()
    run(models, "verify", ["ctc"])
    row = next(r for r in models.snapshot()["models"] if r["kind"] == "ctc")
    assert row["download_bytes"] == len(PAYLOAD)
    assert run(models, "repair", ["ctc"]).status == "succeeded"
    assert len(opener.requests) == 3


def test_resource_busy_does_not_create_job(service):
    models, _ = service
    models.jobs.resource_lock.acquire()
    try:
        with pytest.raises(RuntimeError, match="busy"):
            models.start(ModelAction(action="verify"))
        assert not models.jobs.list()
    finally:
        models.jobs.resource_lock.release()


def test_missing_reminders_survive_skip_and_upgrade(service):
    models, _ = service
    for complete in (False, True):
        preferences = models.runtime.get_settings()
        preferences.model_onboarding_complete = complete
        models.runtime.settings.write(preferences)
        restarted = ModelService(models.runtime, models.jobs, models.catalog)
        run(restarted, "verify", startup=True)
        issues = restarted.snapshot()["startup_issues"]
        assert len(issues) == 3
        assert all(issue["status"] == "missing" and issue["action"] == "download" for issue in issues)


def test_check_failure_preserves_other_findings_and_retry(service, monkeypatch):
    models, _ = service
    run(models, "download")
    (models._target("ctc") / "weight.bin").write_bytes(b"x" * len(PAYLOAD))
    (models._target("demucs") / "weight.bin").unlink()
    original = models._verify
    def broken(kind, *args, **kwargs):
        if kind == "whisper":
            models.verified.pop(kind, None)
            raise PermissionError()
        return original(kind, *args, **kwargs)
    monkeypatch.setattr(models, "_verify", broken)
    assert run(models, "verify", startup=True).status == "failed"
    assert {issue["kind"]: issue["status"] for issue in models.snapshot()["startup_issues"]} == {
        "whisper": "failed", "ctc": "corrupt", "demucs": "missing"}
    monkeypatch.setattr(models, "_verify", original)
    run(models, "verify", startup=True)
    assert {issue["kind"] for issue in models.snapshot()["startup_issues"]} == {"ctc", "demucs"}


def test_phase_bytes_and_single_publication_hash(service, monkeypatch):
    from rollingpebble.auto_timing import model_service
    models, opener = service
    hashed = []
    digest = model_service.file_digest
    def track(path, *args, **kwargs):
        hashed.append(path)
        return digest(path, *args, **kwargs)
    monkeypatch.setattr(model_service, "file_digest", track)
    progress = []
    request = ModelAction(action="download")
    models._work(request, tuple(models.catalog), {}, "modelscope", opener, 30,
                 threading.Event(), progress.append)
    assert len(hashed) == len(CATALOG), "each new file is hashed once, with visible verification progress"
    for stage in ("downloading", "verifying_download"):
        events = [p for p in progress if p.stage == stage]
        assert events[-1].completed == events[-1].total == len(CATALOG) * len(PAYLOAD)
        assert all(p.bytes_total == len(PAYLOAD) and p.completed <= p.total for p in events)
        assert [p.completed for p in events] == sorted(p.completed for p in events)


def test_invalid_final_hash_keeps_installed_directory(service):
    models, opener = service
    run(models, "download", ["ctc"])
    target = models._target("ctc") / "weight.bin"
    target.write_bytes(b"old")
    opener.behavior = "hash"
    assert run(models, "repair", ["ctc"]).status == "failed"
    assert target.read_bytes() == b"old"
    assert statuses(models)["ctc"] == "corrupt"
    assert not (models._staging("ctc") / "weight.bin").exists()


def test_external_inventory_suppresses_duplicate_managed_download(service, tmp_path, monkeypatch):
    models, _ = service
    external = tmp_path / "external"
    external.mkdir()
    (external / "model.bin").write_bytes(b"external")
    preferences = models.runtime.get_settings()
    preferences.auto_timing_v2_options = {"whisper_model": str(external), "ctc_model": str(tmp_path / "absent")}
    models.runtime.settings.write(preferences)
    monkeypatch.setattr("rollingpebble.auto_timing.model_service.inspect_external", lambda *args: True)
    run(models, "verify", startup=True)
    issues = models.snapshot()["startup_issues"]
    assert {(i["kind"], i["origin"], i["action"]) for i in issues} == {
        ("ctc", "external", "configure"), ("demucs", "managed", "download")}
    (external / "model.bin").touch()
    assert any(i["kind"] == "whisper" and i["action"] == "verify" for i in models.snapshot()["startup_issues"])
    monkeypatch.setattr("rollingpebble.auto_timing.model_service.inspect_external", lambda *args: False)
    run(models, "verify", startup=True)
    assert any(i["kind"] == "whisper" and i["action"] == "configure" for i in models.snapshot()["startup_issues"])
    assert (external / "model.bin").read_bytes() == b"external"


def test_legacy_timeout_normalized(tmp_path):
    store = SettingsStore(tmp_path)
    store.path.parent.mkdir(parents=True, exist_ok=True)
    store.path.write_text(json.dumps({"auto_timing_hf_download_timeout": 300}))
    assert store.read().auto_timing_hf_download_timeout == 30
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        RuntimeSettingsUpdateRequest(auto_timing_hf_download_timeout=31)


def test_new_language_models_only_remind_when_selected_or_installed(service):
    models, _ = service
    assert {i['kind'] for i in models.snapshot()['startup_issues']} == {'whisper', 'ctc', 'demucs'}
    run(models, 'download', ['whisper', 'ctc-zh'])
    assert 'ctc-zh' in models.runtime.get_settings().model_prepared_kinds
    models.require({'language': 'zh', 'audio_mode': 'mix'})
    models.require({'language': 'zh-en', 'audio_mode': 'mix'})
    with pytest.raises(AppError):
        models.require({'language': 'mul', 'audio_mode': 'mix'})
    run(models, 'remove', ['ctc-zh'])
    restarted = ModelService(models.runtime, models.jobs, models.catalog)
    run(restarted, 'verify', startup=True)
    issues = {i['kind']: i for i in restarted.snapshot()['startup_issues']}
    assert issues['ctc-zh']['reason'] == 'deleted'
    assert 'ctc-mul' not in issues


def test_unselected_installed_model_is_checked_and_reports_corruption(service):
    models, _ = service
    # A managed model already on disk is verified even if not in the preparation selection.
    target = models._target('ctc-mul')
    target.mkdir(parents=True)
    (target / 'weight.bin').write_bytes(b'x' * len(PAYLOAD))
    result = run(models, 'verify', startup=True)
    assert result.status == 'succeeded'
    issue = next(i for i in models.snapshot()['startup_issues'] if i['kind'] == 'ctc-mul')
    assert issue['status'] == 'corrupt'


@pytest.mark.parametrize('kind', ['ctc', 'ctc-zh', 'ctc-mul'])
def test_one_verified_ctc_suppresses_other_missing_ctc_reminders(service, kind):
    models, _ = service
    run(models, 'download', ['whisper', 'demucs', kind])
    models.runtime.update_settings(RuntimeSettingsUpdateRequest(
        model_prepared_kinds=['whisper', 'ctc', 'ctc-zh', 'ctc-mul', 'demucs']))
    restarted = ModelService(models.runtime, models.jobs, models.catalog)
    run(restarted, 'verify', startup=True)
    assert restarted.snapshot()['startup_issues'] == []
    missing_kind = next(k for k in ['ctc', 'ctc-zh', 'ctc-mul'] if k != kind)
    language = {'ctc': 'en', 'ctc-zh': 'zh', 'ctc-mul': 'mul'}[missing_kind]
    with pytest.raises(AppError):
        restarted.require({'language': language, 'audio_mode': 'mix'})
    run(restarted, 'remove', [kind])
    assert {i['kind'] for i in restarted.snapshot()['startup_issues']} == {'ctc', 'ctc-zh', 'ctc-mul'}


def test_available_ctc_does_not_hide_corruption_or_shared_model_reminders(service):
    models, _ = service
    run(models, 'download', ['ctc-zh'])
    target = models._target('ctc-mul')
    target.mkdir(parents=True)
    (target / 'weight.bin').write_bytes(b'x' * len(PAYLOAD))
    run(models, 'verify', startup=True)
    issues = {i['kind']: i['status'] for i in models.snapshot()['startup_issues']}
    assert issues == {'whisper': 'missing', 'demucs': 'missing', 'ctc-mul': 'corrupt'}


def test_verified_external_ctc_suppresses_missing_managed_ctcs(service, tmp_path, monkeypatch):
    models, _ = service
    external = tmp_path / 'external-ctc'
    external.mkdir()
    (external / 'model.bin').write_bytes(b'external')
    preferences = models.runtime.get_settings()
    preferences.auto_timing_v2_options = {'ctc_zh_model': str(external)}
    preferences.model_prepared_kinds = ['whisper', 'ctc', 'ctc-zh', 'ctc-mul', 'demucs']
    models.runtime.settings.write(preferences)
    monkeypatch.setattr('rollingpebble.auto_timing.model_service.inspect_external', lambda *args: True)
    run(models, 'verify', startup=True)
    assert {i['kind'] for i in models.snapshot()['startup_issues']} == {'whisper', 'demucs'}
    (external / 'model.bin').unlink()
    assert 'ctc' in {i['kind'] for i in models.snapshot()['startup_issues']}


def test_batch_missing_models_are_aggregated(service):
    models, _ = service
    run(models, 'download', ['whisper'])
    with pytest.raises(AppError) as error:
        models.require_many([{'language': 'en', 'audio_mode': 'mix'},
                             {'language': 'zh', 'audio_mode': 'mix'},
                             {'language': 'mul', 'audio_mode': 'vocals'}])
    assert error.value.message.params['models'] == 'ctc,ctc-zh,ctc-mul,demucs'


def test_missing_unselected_managed_copy_does_not_request_download(service):
    models, _ = service
    target = models._target('ctc-mul')
    target.mkdir(parents=True)
    (target / 'weight.bin').write_bytes(PAYLOAD)
    run(models, 'verify', startup=True)
    assert statuses(models)['ctc-mul'] == 'ready'
    (target / 'weight.bin').unlink()
    assert 'ctc-mul' not in {i['kind'] for i in models.snapshot()['startup_issues']}
