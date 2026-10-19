"""Explicit opt-in inference acceptance against an isolated, prepared app data root."""
from __future__ import annotations

import argparse
import json
import shutil
import time
import uuid
from pathlib import Path

from rollingpebble.auto_timing.contracts import ModelAction, Options, RunRequest
from rollingpebble.auto_timing.service import AutoTimingService
from rollingpebble.jobs import JobManager
from rollingpebble.models import ProjectModel
from rollingpebble.paths import StorageLayout
from rollingpebble.runtime.service import RuntimeService
from rollingpebble.services.project_service import ProjectService
from rollingpebble.storage.files import write_project


def validate(root, audio, lyrics):
    layout = StorageLayout.from_data_dir(root).ensure()
    jobs = JobManager(work_root=layout.work_root)
    projects = ProjectService(layout.projects_root)
    runtime = RuntimeService(layout=layout, jobs=jobs)
    check = runtime.models.start(ModelAction(action="verify"))
    jobs.wait(check.job_id)
    assert jobs.get(check.job_id).status == "succeeded"
    service = AutoTimingService(projects=projects, runtime=runtime, jobs=jobs)
    pid = uuid.uuid4().hex
    folder = layout.projects_root / pid
    folder.mkdir()
    shutil.copy2(audio, folder / "audio.wav")
    (folder / "plain.txt").write_text(lyrics.read_text(encoding="utf-8"), encoding="utf-8")
    write_project(layout.projects_root, ProjectModel(project_id=pid, audio_name="audio.wav", audio_ref="audio.wav"))
    before = {p.name: p.read_bytes() for p in folder.iterdir()}
    results = []
    for mode, cancel in (("mix", True), ("mix", False), ("vocals", False)):
        run = service.start(RunRequest(project_id=pid, options=Options(audio_mode=mode, ctc_device="cpu")))
        start = time.monotonic()
        while jobs.resource_lock.locked():
            if cancel and time.monotonic() - start > 3:
                service.cancel(run["id"])
                cancel = False
            if time.monotonic() - start > 1800:
                service.close()
                raise TimeoutError("Inference exceeded 30 minutes")
            time.sleep(.5)
        result = service.store.get(run["id"])
        results.append({"id": result["id"], "mode": mode, "status": result["status"],
                        "elapsed": time.monotonic() - start, "lines": len((result.get("snapshot") or {}).get("lines", [])),
                        "error": result.get("error")})
        print(json.dumps(results[-1]), flush=True)
        assert {p.name: p.read_bytes() for p in folder.iterdir()} == before, "Run modified project"
        if len(results) == 1:
            assert result["status"] == "cancelled", result
        else:
            assert result["status"] == "completed", result
    (root / "acceptance.json").write_text(json.dumps(results, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--lyrics", type=Path, required=True)
    args = parser.parse_args()
    validate(args.data_dir.resolve(), args.audio.resolve(), args.lyrics.resolve())
