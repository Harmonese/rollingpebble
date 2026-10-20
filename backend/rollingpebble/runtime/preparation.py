"""Deduplicated, app-owned preparation; no model downloads or background startup work."""
from __future__ import annotations

import threading

from pydantic import BaseModel, ConfigDict
from typing import Literal

from rollingpebble.runtime.environment import build_base_subprocess_env
from rollingpebble.runtime.installer import bundle_fingerprint


class EnsureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    capability: Literal["original", "vocals"] = "original"
    repair: bool = False
    multilingual: bool = False


class RuntimePreparation:
    def __init__(self, manager, jobs):
        self.manager, self.jobs = manager, jobs
        self.lock = threading.RLock()
        self.thread = None
        self.closed = False
        self.target = "original"
        self.multilingual_target = False
        self.failed_capabilities = set()
        self.key = None
        self.initial_phase = "checking"
        self.state = dict(status="checking", capabilities=[], job_id=None, error=None)

    def snapshot(self):
        with self.lock:
            result = dict(self.state)
            if self.thread and self.thread.is_alive() and result["status"] == "preparing":
                phase = self.manager._read_runtime_metadata("auto").get("preparation_phase")
                result["status"] = phase if phase in {"checking", "preparing"} else self.initial_phase
            return result

    def invalidate(self):
        with self.lock:
            if self.state["status"] != "preparing":
                self.state.update(status="failed", capabilities=[], error="runtime.prepare_failed")
                self.failed_capabilities = {"original", "vocals", "multilingual"}

    def ensure(self, request: EnsureRequest):
        with self.lock:
            if self.closed:
                raise RuntimeError("Auto Timing is shutting down")
            if self.thread and self.thread.is_alive() and self.state["status"] == "preparing":
                self.multilingual_target |= request.multilingual
                if request.capability == "vocals":
                    self.target = "vocals"
                return self.snapshot()
            key = (str(self.manager.layout.runtime_root), bundle_fingerprint())
            if (not request.repair and self.key == key and (self.state["status"] == "ready" or (self.state["status"] == "failed" and self.failed_capabilities and "original" not in self.failed_capabilities))
                    and (not request.multilingual or "multilingual" in self.state["capabilities"])
                    and request.capability in self.state["capabilities"]
                    and self.manager.python_path("auto").exists()):
                return dict(self.state, status="ready", error=None)
            if not request.repair and self.key == key and self.state["status"] == "failed" and (request.capability in self.failed_capabilities or (request.multilingual and "multilingual" in self.failed_capabilities)):
                return dict(self.state)
            if request.repair or self.key != key or not self.manager.python_path("auto").exists():
                self.state["capabilities"] = []
                self.failed_capabilities = set()
            self.target = request.capability
            self.multilingual_target = request.multilingual
            job = self._start(request.capability, request.repair)
            self.key = key
            self.thread = threading.Thread(target=self._follow, args=(job,), daemon=True,
                                           name="auto-timing-preparation")
            self.thread.start()
            return self.snapshot()

    def _start(self, capability, repair=False):
        self.initial_phase = "preparing" if repair or not self.manager.python_path("auto").exists() else "checking"
        command = [*self.manager.install_command("auto"), "--ensure"]
        if capability == "vocals":
            command.append("--vocals")
        if repair:
            command.append("--repair")
        job = self.jobs.create_subprocess_job(kind="runtime_prepare", project_id=None,
                    command=command, cwd=None, env=build_base_subprocess_env())
        self.state.update(status="preparing", job_id=job.job_id, error=None)
        return job

    def _follow(self, job):
        capability = "vocals" if "--vocals" in job.command else "original"
        while True:
            self.jobs.wait(job.job_id)
            with self.lock:
                result = self.jobs.get(job.job_id)
                if result.status != "succeeded" or self.closed:
                    self.state["capabilities"] = []
                    self.failed_capabilities = {capability}
                    self.state.update(status="failed", error="runtime.prepare_failed")
                    return
                metadata = self.manager._read_runtime_metadata("auto")
                capabilities = metadata.get("prepared_capabilities", [])
                self.state.update(capabilities=capabilities)
                if capability not in capabilities:
                    self.failed_capabilities = {capability}
                    self.state.update(status="failed", error="runtime.prepare_failed")
                    return
                if self.multilingual_target and "multilingual" not in capabilities:
                    self.failed_capabilities = {"multilingual"}
                    self.state.update(status="failed", error="runtime.multilingual_failed")
                    return
                self.failed_capabilities = set()
                if self.target in capabilities:
                    self.state.update(status="ready", error=None)
                    return
                try:
                    job = self._start(self.target)
                    capability = self.target
                except Exception:
                    self.failed_capabilities = {capability}
                    self.state.update(status="failed", error="runtime.prepare_failed")
                    return

    def close(self):
        with self.lock:
            self.closed = True
            job_id = self.state["job_id"] if self.state["status"] == "preparing" else None
            thread = self.thread
        if job_id:
            self.jobs.cancel(job_id)
        if thread:
            thread.join(timeout=15)
