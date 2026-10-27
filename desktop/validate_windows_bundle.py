"""Exercise an installed Windows app with fresh data and no developer tools on PATH."""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request


def backend_processes():
    script = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process -Filter \"Name='rollingpebble-backend.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"
    result = subprocess.check_output(["powershell.exe", "-NoProfile", "-Command", script],
                                     encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW)
    value = json.loads(result) if result.strip() else []
    return value if isinstance(value, list) else [value]


def window_for(pid):
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    found = []

    @callback_type
    def inspect(handle, _):
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(handle, ctypes.byref(owner))
        title = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(handle, title, len(title))
        if owner.value == pid and user32.IsWindowVisible(handle) and title.value == "Rolling Pebble":
            found.append(handle)
        return True

    user32.EnumWindows(inspect, 0)
    return found[0] if found else None


def validate(app: Path, log_dir: Path, data_dir: Path | None = None):
    app, log_dir = app.resolve(), log_dir.resolve()
    missing = [str(root / name) for root in (app.parent, app.parent / "python-runtime")
               for name in ("vcruntime140.dll", "vcruntime140_1.dll") if not (root / name).is_file()]
    if missing:
        raise RuntimeError(f"Installer is missing Microsoft runtime files: {missing}")
    log_dir.mkdir(parents=True, exist_ok=True)
    data = data_dir.resolve() if data_dir else log_dir / "data"
    if data.exists():
        raise ValueError("Use a new log directory; native validation requires empty app data")
    env = os.environ.copy()
    for key in ("PYTHON", "PYTHONPATH", "VIRTUAL_ENV", "TAURI_CONFIG", "ROLLINGPEBBLE_BACKEND",
                "ROLLINGPEBBLE_APP_RESOURCES", "ROLLINGPEBBLE_BUNDLED_PYTHON",
                "LRC_ROLLER_RUNTIME_PYTHON", "LRC_ROLLER_FRONTEND_DIST", "PYTHONUTF8", "PYTHONIOENCODING"):
        env.pop(key, None)
    env.update(PATH=str(Path(os.environ["SystemRoot"]) / "System32"),
               LRC_ROLLER_DATA_DIR=str(data),
               ROLLINGPEBBLE_LOCATION_FILE=str(log_dir / "storage-location.json"),
               HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
               WEBVIEW2_USER_DATA_FOLDER=str(log_dir / "webview"))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    native = subprocess.Popen([str(app)], cwd=log_dir, env=env)
    backend_ids = set()
    report = {}
    multilingual_requested = False
    try:
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            if native.poll() is not None:
                raise RuntimeError(f"Native application exited early: {native.returncode}")
            rows = backend_processes()
            owned = {native.pid}
            for _ in range(len(rows) + 1):
                owned.update(row["ProcessId"] for row in rows if row["ParentProcessId"] in owned)
            backends = [row for row in rows if row["ProcessId"] in owned]
            backend_ids.update(row["ProcessId"] for row in backends)
            port = next((int(match[1]) for row in backends
                         if (match := re.search(r"--port\s+(\d+)", row.get("CommandLine") or ""))), None)
            window = window_for(native.pid)
            if port:
                def get(path):
                    with opener.open(f"http://127.0.0.1:{port}{path}", timeout=15) as response:
                        return response.read()
                try:
                    runtime = json.loads(get("/api/runtime/auto-roller"))
                    report = dict(health=json.loads(get("/api/health")), runtime=runtime)
                except OSError:
                    time.sleep(1)
                    continue
                (log_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
                preparation = runtime.get("preparation", {})
                if preparation.get("status") == "failed":
                    job = preparation.get("job_id")
                    detail = get(f"/api/jobs/{job}").decode() if job else report
                    raise RuntimeError(f"Offline startup preparation failed: {detail}")
                if window and preparation.get("status") == "ready":
                    if "multilingual" not in preparation.get("capabilities", []):
                        if not multilingual_requested:
                            request = urllib.request.Request(
                                f"http://127.0.0.1:{port}/api/runtime/auto-roller/ensure",
                                data=json.dumps(dict(capability="original", multilingual=True)).encode(),
                                headers={"Content-Type": "application/json"})
                            with opener.open(request, timeout=15) as response:
                                response.read()
                            multilingual_requested = True
                        time.sleep(1)
                        continue
                    assert report["health"]["ok"] and runtime["available"], report
                    assert runtime["startup_preparation"] and runtime["version"] == "0.10.3", report
                    assert str(data) in runtime["runtime_python"], report
                    asset = re.search(r'<script type="module"[^>]*src="([^"]+)"', get("/").decode())
                    assert asset and len(get(asset[1])) > 1000
                    query = f"[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); (Get-Process -Id {native.pid}).Modules | Where-Object ModuleName -Like 'vcruntime140*.dll' | Select-Object -ExpandProperty FileName | ConvertTo-Json -Compress"
                    raw = subprocess.check_output(["powershell.exe", "-NoProfile", "-Command", query], encoding="utf-8",
                                                  creationflags=subprocess.CREATE_NO_WINDOW)
                    runtime_dlls = json.loads(raw) if raw.strip() else []
                    if isinstance(runtime_dlls, str):
                        runtime_dlls = [runtime_dlls]
                    # Windows may reuse an OS-loaded CRT before application search.
                    # Ship app-local fallbacks and reject developer-tool directories.
                    allowed_dll_dirs = {app.parent, Path(os.environ["SystemRoot"]) / "System32"}
                    assert all(Path(path).parent in allowed_dll_dirs for path in runtime_dlls), runtime_dlls
                    user32 = ctypes.WinDLL("user32", use_last_error=True)
                    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
                    user32.PostMessageW(window, 0x0010, 0, 0)  # normal WM_CLOSE
                    native.wait(timeout=40)
                    remaining = {row["ProcessId"] for row in backend_processes()} & backend_ids
                    assert native.returncode == 0 and not remaining, remaining
                    result = dict(window="Rolling Pebble", runtime="offline startup ready",
                                  version=runtime["version"], frontend="packaged HTML and JavaScript",
                                  capabilities=preparation["capabilities"], normal_exit=0, backend_reaped=True,
                                  native_runtime_dlls=runtime_dlls, runtime_fallbacks_present=True)
                    (log_dir / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
                    print(json.dumps(result, indent=2))
                    return
            time.sleep(1)
        raise TimeoutError(f"Native window/runtime not ready: {report}")
    finally:
        if native.poll() is None:
            subprocess.run(["taskkill.exe", "/PID", str(native.pid), "/T", "/F"],
                           capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
            native.wait(timeout=20)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--log-dir", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, help="Optional short, fresh path for systems without long paths enabled")
    args = parser.parse_args()
    validate(args.app, args.log_dir, args.data_dir)
