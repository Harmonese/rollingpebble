from __future__ import annotations

import hashlib
import json
import os
import shutil
import signal
import subprocess
import threading
import uuid
from pathlib import Path

from rollingpebble.auto_timing.contracts import RunRequest
from rollingpebble.auto_timing.languages import engine_options, required_models, resolve_language
from rollingpebble.auto_timing.protocol import EventStream, compatible, plain_inventory
from rollingpebble.auto_timing.store import ACTIVE, RunStore, now
from rollingpebble.storage.files import resolve_audio_path


def audio_identity(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class AutoTimingService:
    def __init__(self, *, projects, runtime, jobs):
        self.projects = projects
        self.runtime = runtime
        self.jobs = jobs
        self.store = RunStore(runtime.manager.layout.results_root)
        self._processes = {}
        self._lock = threading.RLock()

    def _context(self, request):
        manager = self.runtime.manager
        settings = self.runtime.get_settings()
        runtime = manager.active_runtime(settings)
        if not runtime.ready or not compatible(runtime.version):
            raise ValueError("Auto Timing preparation is incomplete")
        options = request.options.model_dump(exclude_none=True)
        # Downloads are exclusively initiated by the host model manager.
        options["offline"] = True
        options["cache_dir"] = str(manager.engine_data())
        command = [str(runtime.python_path), "-m", "pyroller"]
        env = manager.runtime_env(runtime.venv_path)
        env.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
        return options, command, env

    def _input(self, request):
        project = self.projects.get(request.project_id)
        if request.expected_lyrics is not None and project.plain_lyrics != request.expected_lyrics:
            raise ValueError("Project lyrics changed before Auto Timing")
        if request.expected_audio_ref is not None and project.audio_ref != request.expected_audio_ref:
            raise ValueError("Project audio changed before Auto Timing")
        audio = resolve_audio_path(self.projects.projects_root, project)
        if audio is None or not audio.is_file():
            raise ValueError("Project has no audio file")
        text = plain_inventory(self.projects.plain_lyrics_for_timing(request.project_id))
        identity = audio_identity(audio)
        if request.audio_identity and request.audio_identity != identity:
            raise ValueError("Project audio changed")
        return audio, text, identity

    def preflight(self, request, *, language=None, check_models=True, prepared=None):
        if prepared is None:
            _, text, identity = self._input(request)
            options, command, env = self._context(request)
            language = resolve_language(command[0], text, language or options["language"], env)
            options = engine_options(options, language)
            prepared = {"audio_identity": identity, "lyrics_hash": hashlib.sha256(text.encode()).hexdigest(),
                        "requested_language": request.options.language, "language": language,
                        "required_models": required_models(options), "engine_options": options}
        else:
            options = prepared["engine_options"]
            language = prepared["language"]
            _, command, env = self._context(request)
        if not check_models:
            return prepared
        self.runtime.models.require(options)
        args = [*command, "doctor", "--json", "--cache-dir", options["cache_dir"],
                "--audio-mode", options["audio_mode"], "--language", language]
        for key in ("whisper_model", "ctc_model"):
            if options.get(key):
                args += ["--" + key.replace("_", "-"), options[key]]
        checked = subprocess.run(args, capture_output=True, text=True, env=env, timeout=120)
        try:
            report = json.loads(checked.stdout)
        except ValueError as exc:
            if hasattr(self.runtime, "preparation"):
                self.runtime.preparation.invalidate()
            raise ValueError("Runtime check failed; inspect Settings diagnostics") from exc
        if language == "mul" and any(check.get("name") in {"phonemizer", "langid", "espeak-ng"}
                                     and not check.get("ok") for check in report.get("checks", [])):
            from rollingpebble.messages import AppError
            raise AppError("runtime.multilingual_failed", "Auto Timing multilingual components are unavailable")
        if not report.get("runtime_ok") or not compatible(report.get("engine_version")) or 2 not in report.get("capabilities", {}).get("protocol_versions", []):
            if hasattr(self.runtime, "preparation"):
                self.runtime.preparation.invalidate()
            raise ValueError("Auto Timing runtime check failed")
        if not report.get("ready"):
            raise ValueError("Prepare Auto Timing models in Settings")
        if options["ctc_device"] == "mps":
            device = subprocess.run([command[0], "-c", "import torch; raise SystemExit(0 if torch.backends.mps.is_available() else 1)"],
                                    capture_output=True, env=env, timeout=30)
            if device.returncode:
                raise ValueError("MPS is not available on this device")
        return {**prepared, "ready": True, "doctor": report}


    def _record(self, request, batch_id=None, checked=None):
        audio, text, identity = self._input(request)
        if checked and (checked["audio_identity"] != identity or checked["lyrics_hash"] != hashlib.sha256(text.encode()).hexdigest()):
            raise ValueError("Project changed during preflight")
        checked = checked or self.preflight(request)
        _, command, env = self._context(request)
        options = checked["engine_options"]
        run_id = uuid.uuid4().hex
        record = dict(id=run_id, kind="run", project_id=request.project_id, status="queued",
                      created_at=now(), updated_at=now(), options=request.options.model_dump(),
                      language=checked["language"], requested_language=request.options.language,
                      workspace_id=request.workspace_id, lyrics_version=request.lyrics_version,
                      audio_identity=identity, lyrics_hash=hashlib.sha256(text.encode()).hexdigest(),
                      snapshot=None, progress=None, error=None, batch_id=batch_id, applied=[])
        folder = self.store.create(record)
        snapshot = folder / "audio.snapshot"
        try:
            try:
                os.link(audio, snapshot)
            except OSError:
                shutil.copy2(audio, snapshot)
            if audio_identity(snapshot) != identity:
                raise ValueError("Audio changed while preparing run")
            (folder / "lyrics.txt").write_text(text, encoding="utf-8")
            payload = dict(protocol_version=2, request_id=run_id, audio=str(snapshot.resolve()),
                           lyrics=str((folder / "lyrics.txt").resolve()), output=str((folder / "output").resolve()),
                           options=options)
            (folder / "request.json").write_text(json.dumps(payload), encoding="utf-8")
            record = self.store.update(run_id, command=[*command, "run", "--request", str(folder / "request.json")])
        except Exception as exc:
            snapshot.unlink(missing_ok=True)
            self.store.update(run_id, status="failed", error=str(exc))
            raise
        return record, env

    def start(self, request, *, language=None, retry_of=None):
        if not self.jobs.resource_lock.acquire(blocking=False):
            raise RuntimeError("Auto Timing resources are busy")
        record = None
        try:
            if retry_of is not None:
                from rollingpebble.messages import AppError
                old = self.store.get(retry_of)
                if (old["kind"] != "run" or old["status"] in ACTIVE
                        or old["project_id"] != request.project_id or not old.get("language")
                        or old.get("options") != request.options.model_dump()):
                    raise AppError("timing.retry_input_changed", "Task inputs changed. Start a new task.")
                _, text, identity = self._input(request)
                if (not old.get("audio_identity") or old["audio_identity"] != identity
                        or not old.get("lyrics_hash") or old["lyrics_hash"] != hashlib.sha256(text.encode()).hexdigest()):
                    raise AppError("timing.retry_input_changed", "Task inputs changed. Start a new task.")
                language = old.get("language")
            checked = self.preflight(request, language=language) if language else self.preflight(request)
            if retry_of is not None and (checked["audio_identity"] != old["audio_identity"]
                    or checked["lyrics_hash"] != old["lyrics_hash"]):
                raise AppError("timing.retry_input_changed", "Task inputs changed. Start a new task.")
            record, env = self._record(request, checked=checked)
            def run():
                try:
                    self._execute(record, env)
                finally:
                    self.jobs.resource_lock.release()
            threading.Thread(target=run, daemon=True).start()
            return record
        except BaseException as exc:
            try:
                if record is not None:
                    (self.store.folder(record["id"]) / "audio.snapshot").unlink(missing_ok=True)
                    self.store.update(record["id"], status="failed", error=str(exc))
            finally:
                self.jobs.resource_lock.release()
            raise

    def _execute(self, record, env):
        run_id = record["id"]
        folder = self.store.folder(run_id)
        stream = EventStream(run_id, record["options"].get("alignment_mode", "unordered"),
                             (folder / "lyrics.txt").read_text(encoding="utf-8").splitlines(), record.get("language", "en"))
        process = None
        errors = []
        reader = None
        try:
            with self._lock:
                if self.store.get(run_id)["status"] == "cancelling":
                    self.store.update(run_id, status="cancelled")
                    return
                self.store.update(run_id, status="running")
                process = subprocess.Popen(record["command"], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           text=True, encoding="utf-8", errors="strict", env=env,
                                           start_new_session=os.name != "nt")
                self._processes[run_id] = process
                self.store.update(run_id, engine_pid=process.pid)
            def stderr():
                try:
                    with (folder / "stderr.log").open("w", encoding="utf-8") as log:
                        for chunk in iter(lambda: process.stderr.read(8192), ""):
                            log.write(chunk)
                            log.flush()
                except Exception as exc:
                    errors.append(str(exc))
                    self._stop(process)
            reader = threading.Thread(target=stderr, daemon=True)
            reader.start()
            with (folder / "stdout.jsonl").open("w", encoding="utf-8") as log:
                for raw in iter(lambda: process.stdout.readline(16 * 1024 * 1024 + 1), ""):
                    log.write(raw)
                    log.flush()
                    try:
                        if len(raw) > 16 * 1024 * 1024:
                            raise ValueError("Engine event exceeded 16 MiB")
                        event = stream.accept(raw)
                        if event and event["type"] in {"snapshot", "progress"}:
                            self.store.update(run_id, **{event["type"]: event})
                    except Exception as exc:
                        if not errors:
                            errors.append(str(exc))
                            self._stop(process)
            code = process.wait()
            reader.join()
            if self.store.get(run_id)["status"] == "cancelling" or (stream.terminal or {}).get("type") == "cancelled":
                self.store.update(run_id, status="cancelled", return_code=code)
            elif errors:
                raise ValueError(errors[0])
            else:
                alignment = stream.finish(code, folder / "output")
                self.store.update(run_id, status="completed", return_code=code, duration=alignment["duration"],
                                  metrics=stream.terminal["metrics"], artifacts=stream.terminal["artifacts"])
        except Exception as exc:
            if process and process.poll() is None:
                self._stop(process)
                process.wait()
            status = "cancelled" if self.store.get(run_id)["status"] == "cancelling" else "failed"
            self.store.update(run_id, status=status, error=str(exc))
        finally:
            if reader:
                reader.join(timeout=10)
            if process:
                for pipe in (process.stdout, process.stderr):
                    if pipe:
                        pipe.close()
            with self._lock:
                self._processes.pop(run_id, None)
            (folder / "audio.snapshot").unlink(missing_ok=True)

    @staticmethod
    def _stop(process):
        def stop():
            try:
                if process.poll() is not None:
                    return
                if os.name != "nt":
                    os.killpg(process.pid, signal.SIGTERM)
                else:
                    process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    if os.name != "nt":
                        os.killpg(process.pid, signal.SIGKILL)
                    else:
                        subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)], check=False,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except ProcessLookupError:
                pass
        threading.Thread(target=stop, daemon=True).start()

    def cancel(self, run_id):
        with self._lock:
            record = self.store.get(run_id)
            if record["status"] not in ACTIVE:
                return record
            record = self.store.update(run_id, status="cancelling")
            if record["kind"] == "batch":
                for child in record["children"]:
                    self.cancel(child)
            process = self._processes.get(run_id)
            if process:
                self._stop(process)
            return record

    def batch(self, request, *, languages=None):
        if not self.jobs.resource_lock.acquire(blocking=False):
            raise RuntimeError("Auto Timing resources are busy")
        children = []
        parent_id = uuid.uuid4().hex
        parent = None
        try:
            plans = {}
            for pid in dict.fromkeys(request.project_ids):
                child = RunRequest(project_id=pid, options=request.options)
                plans[pid] = self.preflight(child, check_models=False,
                    **({"language": languages[pid]} if languages and pid in languages else {}))
            self.runtime.models.require_many([plan["engine_options"] for plan in plans.values()])
            checked_inputs = {}
            inspected = set()
            for pid, plan in plans.items():
                key = json.dumps(plan["engine_options"], sort_keys=True)
                if key not in inspected:
                    self.preflight(RunRequest(project_id=pid, options=request.options), prepared=plan)
                    inspected.add(key)
                checked_inputs[pid] = plan
            parent = dict(id=parent_id, kind="batch", project_id=None, status="queued", created_at=now(),
                          updated_at=now(), children=[], options=request.options.model_dump())
            self.store.create(parent)
            # Freeze every input at queue creation, never silently read future edits.
            for pid in dict.fromkeys(request.project_ids):
                child_request = RunRequest(project_id=pid, options=request.options)
                record, env = self._record(child_request, parent_id, checked=checked_inputs[pid])
                children.append((record, env))
            parent = self.store.update(parent_id, children=[r["id"] for r, _ in children])
            def run():
                try:
                    with self._lock:
                        if self.store.get(parent_id)["status"] != "cancelling":
                            self.store.update(parent_id, status="running")
                    for record, env in children:
                        if self.store.get(parent_id)["status"] == "cancelling":
                            self.store.update(record["id"], status="cancelled")
                            (self.store.folder(record["id"]) / "audio.snapshot").unlink(missing_ok=True)
                        else:
                            self._execute(record, env)
                    statuses = [self.store.get(r["id"])["status"] for r, _ in children]
                    status = "cancelled" if self.store.get(parent_id)["status"] == "cancelling" else (
                        "completed" if all(s == "completed" for s in statuses) else "failed")
                    self.store.update(parent_id, status=status)
                finally:
                    self.jobs.resource_lock.release()
            threading.Thread(target=run, daemon=True).start()
            return parent
        except BaseException as exc:
            try:
                for record, _ in children:
                    (self.store.folder(record["id"]) / "audio.snapshot").unlink(missing_ok=True)
                    self.store.update(record["id"], status="cancelled")
                if parent is not None:
                    ids = [r["id"] for r in self.store.list() if r.get("batch_id") == parent_id]
                    self.store.update(parent_id, status="failed", children=ids, error=str(exc))
            finally:
                self.jobs.resource_lock.release()
            raise

    def delete_results(self, record_id, *, kind):
        if not self.jobs.resource_lock.acquire(blocking=False):
            raise ValueError("Auto Timing resources are busy")
        try:
            with self.store.lock:
                record = self.store.get(record_id)
                if record["kind"] != kind:
                    raise ValueError("Unexpected result kind")
                records = [record]
                parent = None
                if kind == "batch":
                    records += [self.store.get(child) for child in record["children"]]
                elif record.get("batch_id"):
                    parent = self.store.get(record["batch_id"])
                if any(row["status"] in ACTIVE for row in records) or (parent and parent["status"] in ACTIVE):
                    raise ValueError("Run is still active")
                deleted_ids = [row["id"] for row in records]
                if parent:
                    remaining = [child for child in parent["children"] if child != record_id]
                    if remaining:
                        self.store.update(parent["id"], children=remaining)
                    else:
                        records.append(parent)
                        deleted_ids.append(parent["id"])
                # Resolve every path before removing anything. Delete the parent last.
                folders = [self.store.folder(row["id"]) for row in sorted(records, key=lambda row: row["kind"] == "batch")]
                for folder in folders:
                    shutil.rmtree(folder)
                return {"deleted": True, "deleted_ids": deleted_ids}
        finally:
            self.jobs.resource_lock.release()

    def close(self):
        for record in self.store.list():
            if record["status"] in ACTIVE:
                self.cancel(record["id"])
        with self._lock:
            processes = list(self._processes.values())
        for process in processes:
            try:
                process.wait(timeout=12)
            except subprocess.TimeoutExpired:
                self._stop(process)
