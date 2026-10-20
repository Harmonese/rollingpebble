"""Exercise packaged APIs in isolated data; no browser or UI automation."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import time
from pathlib import Path

import httpx


def validate(app: Path, root: Path, models: Path, audio: Path, lyrics: Path, language="auto"):
    if root.exists():
        raise ValueError("Use a new isolated directory")
    root.mkdir(parents=True)
    resources = app / "Contents" / "Resources"
    executable = resources / "bin" / "rollingpebble-backend"
    env = {key: value for key, value in os.environ.items() if key in {"HOME", "TMPDIR", "LANG"}}
    env.update(PATH="/usr/bin:/bin", ROLLINGPEBBLE_APP_RESOURCES=str(resources), LRC_ROLLER_DATA_DIR=str(root))
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    results = {}
    with (root / "backend.log").open("w") as log:
        process = subprocess.Popen([str(executable), "serve", "--host", "127.0.0.1", "--port", str(port),
                                    "--data-dir", str(root)], env=env, stdout=log, stderr=log)
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=180, trust_env=False) as client:
                deadline = time.monotonic() + 60
                while True:
                    try:
                        response = client.get("/api/health")
                        response.raise_for_status()
                        break
                    except httpx.HTTPError:
                        if process.poll() is not None or time.monotonic() > deadline:
                            raise RuntimeError("Bundled backend did not start")
                        time.sleep(.3)

                def call(method, url, **kwargs):
                    response = client.request(method, url, **kwargs)
                    response.raise_for_status()
                    return response.json()

                def job(url, body=None):
                    record = call("POST", url, json=body or {})
                    deadline = time.monotonic() + 600
                    while record["status"] in {"running", "queued"}:
                        if time.monotonic() > deadline:
                            raise TimeoutError("Runtime job timed out")
                        time.sleep(.5)
                        record = call("GET", f'/api/jobs/{record["job_id"]}')
                    assert record["status"] == "succeeded", record
                    print(json.dumps(dict(job=url, status=record["status"])), flush=True)
                    return record

                assert "<html" in client.get("/").text.lower()
                assert call("GET", "/api/projects") == []
                def prepare(capability="original"):
                    deadline = time.monotonic() + 600
                    while True:
                        state = call("POST", "/api/runtime/auto-roller/ensure", json={"capability": capability})
                        if state["status"] == "ready":
                            assert capability in state["capabilities"]
                            return
                        if state["status"] == "failed" or time.monotonic() > deadline:
                            raise RuntimeError(f"Component preparation failed: {state}")
                        time.sleep(.5)

                prepare()
                runtime = call("GET", "/api/runtime/auto-roller")
                assert runtime["runtime_status"] == "ready", runtime
                assert runtime["doctor_report"]["ready"] is False
                assert str(root / "runtime") in Path(runtime["runtime_python"]).resolve().as_posix()
                results["fresh_install"] = dict(runtime_ok=True, models_ready=False, python=runtime["runtime_python"])
                prepare()
                prepare("vocals")
                target = root / "engine" / "models"
                # Reuse only the explicitly supplied isolated model set. No global
                # developer or user cache is discovered by this acceptance script.
                def copy(source, destination):
                    try:
                        os.link(source, destination)
                    except OSError:
                        shutil.copy2(source, destination)
                shutil.copytree(models, target, copy_function=copy, dirs_exist_ok=True)
                job("/api/auto-timing/models", {"action": "verify"})
                with audio.open("rb") as file:
                    project = call("POST", "/api/projects", files={"audio": (audio.name, file, "audio/wav")})
                pid = project["project_id"]
                plain = lyrics.read_text(encoding="utf-8")
                call("POST", f"/api/projects/{pid}/lyrics", json={"plain_lyrics": plain})
                folder = root / "projects" / pid
                before = {p.name: p.read_bytes() for p in folder.iterdir() if p.is_file()}
                results["runs"] = []
                for mode, should_cancel in (("mix", True), ("mix", False), ("vocals", False)):
                    started = time.monotonic()
                    run = call("POST", "/api/auto-timing/runs", json={"project_id": pid, "options": {"audio_mode": mode, "ctc_device": "cpu", "language": language}})
                    while run["status"] in {"running", "queued", "cancelling"}:
                        if should_cancel and time.monotonic() - started > 5:
                            call("POST", f'/api/auto-timing/runs/{run["id"]}/cancel')
                            should_cancel = False
                        if time.monotonic() - started > 1800:
                            raise TimeoutError("Inference timed out")
                        time.sleep(.5)
                        run = call("GET", f'/api/auto-timing/runs/{run["id"]}')
                    result = dict(mode=mode, id=run["id"], status=run["status"], elapsed=round(time.monotonic() - started, 2),
                                  lines=len((run.get("snapshot") or {}).get("lines", [])), error=run.get("error"))
                    results["runs"].append(result)
                    print(json.dumps(result), flush=True)
                    assert run["status"] == ("cancelled" if len(results["runs"]) == 1 else "completed"), run
                    assert {p.name: p.read_bytes() for p in folder.iterdir() if p.is_file()} == before
                    # Terminal publication precedes final lock release by a few instructions.
                    time.sleep(.5)
                results["project_unchanged"] = True
                run_id = results["runs"][1]["id"]
                run = call("GET", f"/api/auto-timing/runs/{run_id}")
                draft = call("PUT", f"/api/auto-timing/runs/{run_id}/draft", json={"version": 0,
                    "base_revision": run["snapshot"]["revision"], "lines": [{"id": "review", "text": "Reviewed", "time": 0}]})
                assert draft["version"] == 1
                assert call("GET", f"/api/auto-timing/runs/{run_id}/draft")["lines"][0]["time"] == 0
                results["draft_api"] = True
        finally:
            process.terminate()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            results["backend_exit"] = process.returncode
            (root / "acceptance.json").write_text(json.dumps(results, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("app", "data-dir", "models", "audio", "lyrics"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--language", choices=["auto", "en", "zh", "zh-en", "mul"], default="auto")
    args = parser.parse_args()
    validate(args.app.resolve(), args.data_dir.resolve(), args.models.resolve(), args.audio.resolve(), args.lyrics.resolve(), args.language)
