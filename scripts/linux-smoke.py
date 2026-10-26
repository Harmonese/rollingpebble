"""Smoke-test a chosen Python installation with isolated application data."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", default=str(Path(__file__).resolve().parents[1] / ".venv/bin/python"))
    args = parser.parse_args()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="rollingpebble-linux-smoke-") as temporary:
        root = Path(temporary)
        env = os.environ.copy()
        env.pop("PYTHONPATH", None)
        env.pop("LRC_ROLLER_FRONTEND_DIST", None)
        env.pop("ROLLINGPEBBLE_APP_RESOURCES", None)
        env["LRC_ROLLER_DATA_DIR"] = str(root / "data")
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with (root / "server.log").open("w+") as log:
            process = subprocess.Popen(
                [args.python, "-m", "rollingpebble.cli", "serve", "--port", str(port)],
                cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT,
            )
            try:
                deadline = time.monotonic() + 90
                while True:
                    if process.poll() is not None:
                        log.seek(0)
                        raise RuntimeError(log.read())
                    try:
                        with opener.open(f"http://127.0.0.1:{port}/api/health", timeout=2) as response:
                            health = json.load(response)
                        break
                    except (OSError, urllib.error.URLError):
                        if time.monotonic() >= deadline:
                            raise TimeoutError("Backend did not become ready")
                        time.sleep(0.2)
                assert health["ok"] is True, health
                assert Path(health["data_dir"]) == root / "data", health
                assert health["pylrclib"]["available"] is True, health
                with opener.open(f"http://127.0.0.1:{port}/", timeout=5) as response:
                    html = response.read().decode()
                    assert response.status == 200 and '<script type="module"' in html
                print(json.dumps({"health": health, "frontend": "HTTP 200, built module present"}, ensure_ascii=False, indent=2))
            finally:
                process.terminate()
                try:
                    process.wait(timeout=25)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                if process.returncode not in (0, -15):
                    log.seek(0)
                    print(log.read())


if __name__ == "__main__":
    main()
