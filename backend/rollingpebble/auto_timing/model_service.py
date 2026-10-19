from __future__ import annotations

import json
import shutil
import threading

from rollingpebble.auto_timing.model_catalog import CATALOG
from rollingpebble.auto_timing.model_download import (
    ModelCancelled, check_cancel, download_file, download_opener, file_digest,
)
from rollingpebble.auto_timing.store import atomic_json
from rollingpebble.auto_timing.model_external import external_signature, inspect_external
from rollingpebble.messages import AppError
from rollingpebble.models import JobProgressModel

ACTIVE = {"queued", "running", "cancelling"}


class ModelService:
    def __init__(self, runtime, jobs, catalog=None):
        self.runtime, self.jobs = runtime, jobs
        self.catalog = catalog or CATALOG
        self.lock = threading.RLock()
        self.verified = {}
        self.states = {}
        self.job_id = None
        self.operation = None
        self.external = {}
        self.root = None

    def _paths(self):
        root = self.runtime.manager.engine_data() / "models"
        if root != self.root:
            self.root = root
            self.verified.clear()
            self.states.clear()
            self.external.clear()
        return root

    def _target(self, kind):
        root = self._paths()
        target = root / kind / self.catalog[kind].revision
        if any(path.is_symlink() for path in (root, root / kind, target)):
            raise AppError("models.path", "Model path is not a managed directory.")
        return target

    def _records(self):
        path = self._paths() / ".installations.json"
        return json.loads(path.read_text()) if path.exists() else {}

    def _record(self, kind, state):
        records = self._records()
        records[kind] = {"state": state, "revision": self.catalog[kind].revision}
        atomic_json(self._paths() / ".installations.json", records)

    def _recover(self, kind):
        target = self._target(kind)
        backup = target.with_name(target.name + ".previous")
        incoming = target.with_name(target.name + ".incoming")
        if backup.is_symlink() or incoming.is_symlink():
            raise AppError("models.path", "Model path is not a managed directory.")
        if backup.exists():
            if not target.exists():
                backup.rename(target)
            else:
                shutil.rmtree(backup)
        if incoming.exists():
            shutil.rmtree(incoming)

    def _signature(self, kind):
        target = self._target(kind)
        result = [str(target)]
        for file in self.catalog[kind].files:
            path = target / file.name
            if not path.is_file() or path.is_symlink():
                result.append(None)
                continue
            stat = path.stat()
            result.append((file.sha256, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino))
        return tuple(result)

    def snapshot(self):
        with self.lock:
            self._paths()
            job = self.jobs.get(self.job_id) if self.job_id else None
            running = job is not None and job.status in ACTIVE
            records = self._records()
            settings = self.runtime.get_settings()
            explicit = settings.auto_timing_v2_options
            rows = []
            issues = []
            for kind, spec in self.catalog.items():
                try:
                    if not running:
                        self._recover(kind)
                    target = self._target(kind)
                    signature = self._signature(kind)
                    missing = any(entry is None for entry in signature[1:])
                except (OSError, AppError):
                    target = self._paths() / kind / spec.revision
                    signature = None
                    missing = False
                state = self.states.get(kind, {})
                ready = signature is not None and self.verified.get(kind) == signature
                installed = records.get(kind, {}).get("state") == "installed"
                status = "ready" if ready else "failed" if signature is None else "missing" if missing else "unverified"
                if state.get("status") in {"corrupt", "failed"} and not ready and not missing:
                    status = state["status"]
                if running and state.get("status") in {"checking", "downloading"}:
                    status = state["status"]
                valid_files = state.get("valid_files", {}) if state.get("signature") == signature and signature else {}
                size = sum(f.size for f in spec.files)
                rows.append(dict(kind=kind, available=ready, status=status, path=str(target),
                    total_bytes=size, checked_bytes=state.get("checked_bytes", 0),
                    download_bytes=0 if ready else sum(f.size for f in spec.files if f.name not in valid_files),
                    repair_needed=status in {"corrupt", "failed"},
                    error=state.get("error"), failure_phase=state.get("failure_phase"),
                    job_id=job.job_id if running and kind in self.operation[1] else None))
                if not explicit.get(kind + "_model") and status in {"missing", "corrupt", "failed", "unverified"}:
                    reason = ("unexpected_loss" if installed else records.get(kind, {}).get("state", "not_installed")) if status == "missing" else state.get("failure_phase", status)
                    action = "download" if status == "missing" else "verify" if status in {"failed", "unverified"} else "repair"
                    if status == "failed" and reason == "downloading":
                        action = "repair" if installed else "download"
                    issues.append(dict(kind=kind, origin="managed", status=status, reason=reason,
                                       action=action))
            external_rows = []
            for kind in ("whisper", "ctc"):
                path = explicit.get(kind + "_model")
                if not path:
                    continue
                try:
                    signature = external_signature(path)
                    state = self.external.get(kind, {})
                    status = state.get("status", "unverified") if state.get("signature") == signature else "unverified"
                    if signature[1] is None:
                        status = "missing"
                except OSError:
                    status = "failed"
                external_rows.append(dict(kind=kind, path=path, status=status))
                if status != "available":
                    issues.append(dict(kind=kind, origin="external", status=status, reason="external_path",
                                       action="verify" if status == "unverified" else "configure"))
            return {"models": rows, "job": job, "explicit": explicit, "external_models": external_rows,
                    "startup_issues": issues, "onboarding_complete": settings.model_onboarding_complete}

    def require(self, options):
        with self.lock:
            required = [k for k in ("whisper", "ctc") if not options.get(k + "_model")]
            if options["audio_mode"] == "vocals":
                required.append("demucs")
            states = {r["kind"]: r for r in self.snapshot()["models"]}
            if any(states[k]["status"] != "ready" for k in required):
                raise AppError("models.not_verified", "Verify or download Auto Timing models in Settings.")

    def start(self, request):
        with self.lock:
            if request.startup and request.action != "verify":
                raise ValueError("Startup checks cannot download or delete models")
            snapshot = self.snapshot()
            requested = request.kinds or ([request.kind] if request.kind else list(self.catalog))
            kinds = tuple(k for k in self.catalog if k in requested)
            if request.startup:
                kinds = tuple(k for k in self.catalog if not snapshot["explicit"].get(k + "_model"))
            key = (request.action, kinds, request.startup)
            if snapshot["job"] and snapshot["job"].status in ACTIVE:
                if self.operation == key:
                    return snapshot["job"]
                raise RuntimeError("Auto Timing resources are busy")
            settings = self.runtime.get_settings()
            proxy = settings.auto_timing_hf_proxy if settings.model_proxy_enabled else ""
            opener = download_opener(proxy) if request.action in {"download", "repair"} else None
            source = settings.model_download_source
            timeout = settings.auto_timing_hf_download_timeout or 30
            def work(cancel, progress):
                return self._work(request, kinds, settings.auto_timing_v2_options,
                                  source, opener, timeout, cancel, progress)
            self.operation = key
            job = self.jobs.create_worker_job(kind="runtime_cache_model", worker=work)
            self.job_id = job.job_id
            return job

    def _work(self, request, kinds, explicit, source, opener, timeout, cancel, progress):
        errors = []
        pending = []
        sizes = {}
        for kind in kinds:
            try:
                sizes[kind] = sum(f.size for f in self.catalog[kind].files
                    if (p := self._target(kind) / f.name).is_file() and not p.is_symlink()
                    and p.stat().st_size == f.size)
                if (request.action != "verify" or request.startup) and self.verified.get(kind) == self._signature(kind):
                    sizes[kind] = 0
            except (OSError, AppError):
                sizes[kind] = 0

        def phase(name, selected, sizes, operation):
            completed = 0
            total = sum(sizes.values())
            for kind in selected:
                check_cancel(cancel)
                processed = 0
                def update(_stage, count, model_total):
                    nonlocal processed
                    processed = count
                    progress(JobProgressModel(stage=name, completed=completed + count, total=total,
                        unit="bytes", bytes_downloaded=count, bytes_total=model_total,
                        detail={"kind": kind, "action": request.action}))
                update(name, 0, sizes[kind])
                try:
                    operation(kind, update)
                except ModelCancelled:
                    with self.lock:
                        self.states[kind] = {}
                    raise
                except Exception as exc:
                    code = exc.message.code if isinstance(exc, AppError) else (
                        "models.disk_full" if getattr(exc, "errno", None) == 28 else "models.operation_failed")
                    with self.lock:
                        self.states[kind] = {"status": "corrupt" if code == "models.hash" else "failed", "error": code, "failure_phase": name}
                    errors.append(AppError(code, "Model operation failed."))
                completed += processed

        def verify(kind, update):
            self._recover(kind)
            if request.action == "remove":
                self._remove(kind)
            elif not self._verify(kind, cancel, update, force=request.action == "verify" and not request.startup):
                pending.append(kind)
        phase("checking", kinds, sizes, verify)
        if request.startup:
            for kind in ("whisper", "ctc"):
                path = explicit.get(kind + "_model")
                if path:
                    check_cancel(cancel)
                    progress(JobProgressModel(stage="checking_external", detail={"kind": kind}))
                    signature = None
                    try:
                        signature = external_signature(path)
                        previous = self.external.get(kind, {})
                        valid = previous.get("signature") == signature and previous.get("status") == "available"
                        valid = valid or (signature[1] is not None and inspect_external(self.runtime.manager, kind, path, cancel))
                        state = dict(signature=signature, status="available" if valid else "failed")
                    except ModelCancelled:
                        raise
                    except Exception:
                        state = dict(signature=signature, status="failed")
                    with self.lock:
                        self.external[kind] = state
        if request.action in {"download", "repair"}:
            sizes = {k: sum(f.size for f in self.catalog[k].files
                           if f.name not in self.states[k].get("valid_files", {})) for k in pending}
            staged = []
            def download(kind, update):
                self._stage(kind, source, opener, timeout, cancel, update)
                staged.append(kind)
            phase("downloading", pending, sizes, download)
            sizes = {k: sum(f.size for f in self.catalog[k].files) for k in staged}
            phase("verifying_download", staged, sizes,
                  lambda kind, update: self._publish(kind, cancel, update))
        check_cancel(cancel)
        if errors:
            raise errors[0]
        return {"models": list(kinds)}

    def _verify(self, kind, cancel, progress, force=False):
        with self.lock:
            target = self._target(kind)
            signature = self._signature(kind)
            if not target.exists() and self._records().get(kind, {}).get("state") != "installed":
                self.states[kind] = {"status": "missing"}
                return False
            if not force and signature is not None and self.verified.get(kind) == signature:
                progress("checking", 0, 0)
                return True
            self.verified.pop(kind, None)
            if target.exists() and self._records().get(kind, {}).get("state") != "installed":
                self._record(kind, "installed")
            self.states[kind] = {"status": "checking", "checked_bytes": 0}
        spec = self.catalog[kind]
        total = sum(f.size for f in spec.files if (p := target / f.name).is_file()
                    and not p.is_symlink() and p.stat().st_size == f.size)
        checked = 0
        valid_files = {}
        def advance(count):
            nonlocal checked
            checked += count
            with self.lock:
                self.states[kind]["checked_bytes"] = checked
            progress("checking", checked, total)
        progress("checking", 0, total)
        for file in spec.files:
            check_cancel(cancel)
            path = target / file.name
            if path.is_file() and not path.is_symlink() and path.stat().st_size == file.size:
                if file_digest(path, cancel, advance) == file.sha256:
                    valid_files[file.name] = True
        with self.lock:
            valid = len(valid_files) == len(spec.files) and signature == self._signature(kind)
            if valid:
                self.verified[kind] = signature
            else:
                self.verified.pop(kind, None)
            status = "ready" if valid else "missing" if any(item is None for item in signature[1:]) else "corrupt"
            self.states[kind].update(status=status, valid_files=valid_files, signature=signature)
            return valid

    def _staging(self, kind):
        return self.runtime.manager.layout.cache_root / "model-downloads" / kind / self.catalog[kind].revision

    def _stage(self, kind, source, opener, timeout, cancel, progress):
        spec = self.catalog[kind]
        target = self._target(kind)
        stage = self._staging(kind)
        if any(p.is_symlink() for p in (stage, stage.parent, stage.parent.parent)):
            raise AppError("models.path", "Model path is not a managed directory.")
        stage.mkdir(parents=True, exist_ok=True)
        needed = sum(max(0, f.size - ((stage / f.name).stat().st_size if (stage / f.name).is_file() else 0))
                     for f in spec.files)
        if shutil.disk_usage(stage).free < needed:
            raise AppError("models.disk_full", "Not enough disk space.")
        with self.lock:
            valid_files = self.states[kind].get("valid_files", {})
            self.states[kind]["status"] = "downloading"
        total = sum(f.size for f in spec.files if f.name not in valid_files)
        done = 0
        progress("downloading", 0, total)
        for file in spec.files:
            check_cancel(cancel)
            path = stage / file.name
            if path.is_symlink():
                raise AppError("models.path", "Model path is not a managed directory.")
            if file.name in valid_files:
                shutil.copyfile(target / file.name, path)
            elif file.inline is not None and source == "official":
                path.write_bytes(file.inline)
                done += file.size
            else:
                download_file(file, spec.url(file, source), path, opener=opener, cancel=cancel,
                              progress=lambda value: progress("downloading", done + value, total), timeout=timeout,
                              verify=False)
                done += file.size
        progress("downloading", done, total)

    def _publish(self, kind, cancel, progress):
        spec = self.catalog[kind]
        stage = self._staging(kind)
        target = self._target(kind)
        # Recheck the staged set, including reused files, before touching the installed directory.
        checked = 0
        size = sum(f.size for f in spec.files)
        with self.lock:
            self.states[kind]["status"] = "checking"
        def advance(count):
            nonlocal checked
            checked += count
            progress("checking", checked, size)
        for file in spec.files:
            if file_digest(stage / file.name, cancel, advance) != file.sha256:
                (stage / file.name).unlink()
                raise AppError("models.hash", "Model checksum did not match.")
        check_cancel(cancel)
        target.parent.mkdir(parents=True, exist_ok=True)
        backup = target.with_name(target.name + ".previous")
        incoming = target.with_name(target.name + ".incoming")
        # Cache and models share the application root/filesystem. Rename the verified
        # staging directory so multi-GiB weights need no second temporary copy.
        stage.rename(incoming)
        with self.lock:
            if target.exists():
                target.rename(backup)
            try:
                incoming.rename(target)
                self._record(kind, "installed")
            except BaseException:
                if target.exists():
                    shutil.rmtree(target)
                if backup.exists():
                    backup.rename(target)
                raise
            self.verified[kind] = self._signature(kind)
            self.states[kind] = {"status": "ready", "checked_bytes": sum(f.size for f in spec.files)}
            if backup.exists():
                shutil.rmtree(backup)

    def _remove(self, kind):
        with self.lock:
            target = self._target(kind)
            # Keep deletion provenance; it no longer suppresses startup reminders.
            self._record(kind, "deleted")
            self.verified.pop(kind, None)
            self.states.pop(kind, None)
            if target.exists():
                shutil.rmtree(target)

    def close(self):
        if self.job_id:
            self.jobs.cancel(self.job_id)
            self.jobs.wait(self.job_id)
