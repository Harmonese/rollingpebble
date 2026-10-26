"""Launch an extracted Linux package with isolated data, PATH and X display."""

from __future__ import annotations

import argparse
import ctypes
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def descendants(pid):
    result = []
    try:
        children = Path(f"/proc/{pid}/task/{pid}/children").read_text().split()
    except FileNotFoundError:
        return result
    for child in map(int, children):
        result.append(child)
        result.extend(descendants(child))
    return result


def running(pid):
    try:
        return Path(f"/proc/{pid}/stat").read_text().split(") ", 1)[1][0] != "Z"
    except FileNotFoundError:
        return False


def close_window(display, window):
    class Message(ctypes.Structure):
        _fields_ = [
            ("type", ctypes.c_int),
            ("serial", ctypes.c_ulong),
            ("send_event", ctypes.c_int),
            ("display", ctypes.c_void_p),
            ("window", ctypes.c_ulong),
            ("message_type", ctypes.c_ulong),
            ("format", ctypes.c_int),
            ("data", ctypes.c_long * 5),
        ]

    x11 = ctypes.CDLL("libX11.so.6")
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    x11.XInternAtom.restype = ctypes.c_ulong
    x11.XSendEvent.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_int,
        ctypes.c_long,
        ctypes.c_void_p,
    ]
    x11.XFlush.argtypes = [ctypes.c_void_p]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    connection = x11.XOpenDisplay(display.encode())
    if not connection:
        raise RuntimeError("Cannot open test display")
    event = (ctypes.c_long * 24)()
    message = Message.from_buffer(event)
    message.type, message.display, message.window, message.format = 33, connection, window, 32
    message.message_type = x11.XInternAtom(connection, b"WM_PROTOCOLS", 0)
    message.data[0] = x11.XInternAtom(connection, b"WM_DELETE_WINDOW", 0)
    x11.XSendEvent(connection, window, 0, 0, ctypes.byref(event))
    x11.XFlush(connection)
    x11.XCloseDisplay(connection)


def validate(args):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with tempfile.TemporaryDirectory(prefix="rollingpebble-desktop-") as temporary:
        root = Path(temporary)
        package = root / "installed 桌面应用"
        package.mkdir()
        if args.deb:
            subprocess.run(["dpkg-deb", "-x", str(args.deb.resolve()), str(package)], check=True)
            command = package / "usr/bin/rollingpebble-desktop"
        else:
            subprocess.run(
                [str(args.appimage.resolve()), "--appimage-extract"],
                cwd=package,
                check=True,
                stdout=subprocess.DEVNULL,
            )
            command = package / "squashfs-root/AppRun"
        read_fd, write_fd = os.pipe()
        xvfb = None
        app = None
        groups = set()
        backend_pids = set()
        args.log_dir.mkdir(parents=True, exist_ok=True)
        with (
            (args.log_dir / "xvfb.log").open("w") as xlog,
            (args.log_dir / "native.log").open("w+") as log,
        ):
            try:
                xvfb = subprocess.Popen(
                    [
                        str(args.xvfb.resolve()),
                        "-displayfd",
                        str(write_fd),
                        "-screen",
                        "0",
                        "1280x900x24",
                        "-nolisten",
                        "tcp",
                        "-ac",
                    ],
                    pass_fds=(write_fd,),
                    stdout=xlog,
                    stderr=xlog,
                )
                os.close(write_fd)
                if not select.select([read_fd], [], [], 20)[0]:
                    raise TimeoutError("Xvfb did not start")
                display = ":" + os.read(read_fd, 32).decode().strip()
                if display == ":":
                    raise RuntimeError("Xvfb exited before allocating a display")
                os.close(read_fd)
                env = os.environ.copy()
                for key in (
                    "PYTHON",
                    "PYTHONPATH",
                    "VIRTUAL_ENV",
                    "TAURI_CONFIG",
                    "WAYLAND_DISPLAY",
                    "ROLLINGPEBBLE_BACKEND",
                    "ROLLINGPEBBLE_APP_RESOURCES",
                    "ROLLINGPEBBLE_BUNDLED_PYTHON",
                    "LRC_ROLLER_RUNTIME_PYTHON",
                    "LRC_ROLLER_FRONTEND_DIST",
                    "APPDIR",
                    "APPIMAGE",
                    "LD_LIBRARY_PATH",
                    "SSH_AUTH_SOCK",
                    "GNOME_KEYRING_CONTROL",
                    "SESSION_MANAGER",
                ):
                    env.pop(key, None)
                env.update(
                    PATH="/usr/bin:/bin",
                    HOME=str(root / "home"),
                    DISPLAY=display,
                    GDK_BACKEND="x11",
                    LIBGL_ALWAYS_SOFTWARE="1",
                    WEBKIT_DISABLE_DMABUF_RENDERER="1",
                    LRC_ROLLER_DATA_DIR=str(root / "data"),
                    XDG_CACHE_HOME=str(root / "cache"),
                    XDG_CONFIG_HOME=str(root / "config"),
                    XDG_DATA_HOME=str(root / "share"),
                    XDG_RUNTIME_DIR=str(root / "run"),
                )
                Path(env["HOME"]).mkdir()
                Path(env["XDG_RUNTIME_DIR"]).mkdir(mode=0o700)
                app = subprocess.Popen(
                    ["/usr/bin/dbus-run-session", "--", str(command)],
                    cwd=root,
                    env=env,
                    stdout=log,
                    stderr=log,
                    start_new_session=True,
                )
                groups.add(app.pid)
                deadline = time.monotonic() + 300
                port = None
                window = None
                report = {}
                while time.monotonic() < deadline:
                    if app.poll() is not None:
                        log.seek(0)
                        raise RuntimeError(f"Native application exited: {log.read()}")
                    for pid in descendants(app.pid):
                        try:
                            groups.add(os.getpgid(pid))
                            argv = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
                        except (FileNotFoundError, ProcessLookupError):
                            continue
                        if argv and b"rollingpebble-backend" in argv[0] and b"--port" in argv:
                            port = int(argv[argv.index(b"--port") + 1])
                            backend_pids.add(pid)
                    tree = subprocess.check_output(
                        ["/usr/bin/xwininfo", "-root", "-tree"], env=env, text=True
                    )
                    match = re.search(r'(0x[0-9a-f]+) "Rolling Pebble"', tree)
                    if match:
                        window = int(match[1], 16)
                    if port:

                        def get(path):
                            with opener.open(
                                f"http://127.0.0.1:{port}{path}", timeout=10
                            ) as response:
                                return response.read()

                        try:
                            health = json.loads(get("/api/health"))
                            runtime = json.loads(get("/api/runtime/auto-roller"))
                        except (OSError, urllib.error.URLError):
                            time.sleep(0.3)
                            continue
                        report = dict(health=health, runtime=runtime)
                        (args.log_dir / "report.json").write_text(json.dumps(report, indent=2))
                        if runtime["preparation"].get("status") == "failed":
                            job_id = runtime["preparation"].get("job_id")
                            detail = get(f"/api/jobs/{job_id}").decode() if job_id else ""
                            raise RuntimeError(f"Bundled runtime preparation failed: {detail}")
                        if window and runtime["preparation"].get("status") == "ready":
                            assert (
                                health["ok"]
                                and runtime["startup_preparation"]
                                and runtime["available"]
                            ), report
                            assert runtime["version"] == "0.10.3", report
                            assert str(root / "data") in runtime["runtime_python"], report
                            html = get("/").decode()
                            asset = re.search(r'<script type="module"[^>]*src="([^"]+)"', html)
                            assert asset and len(get(asset[1])) > 1000
                            break
                    time.sleep(0.5)
                else:
                    raise TimeoutError(f"Native window/runtime not ready: {report}")
                close_window(display, window)
                app.wait(timeout=30)
                assert app.returncode == 0, app.returncode
                time.sleep(0.5)
                assert not any(running(pid) for pid in backend_pids), backend_pids
                result = dict(
                    window="Rolling Pebble",
                    runtime="offline startup ready",
                    version=runtime["version"],
                    capabilities=runtime["preparation"]["capabilities"],
                    frontend="HTML and JavaScript served from package",
                    normal_exit=app.returncode,
                    backend_reaped=True,
                )
                (args.log_dir / "result.json").write_text(json.dumps(result, indent=2))
                print(json.dumps(result, indent=2))
            finally:
                if app and app.poll() is None:
                    for pid in descendants(app.pid):
                        try:
                            groups.add(os.getpgid(pid))
                        except ProcessLookupError:
                            pass
                for group in groups:
                    try:
                        os.killpg(group, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                if app:
                    try:
                        app.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        for group in groups:
                            try:
                                os.killpg(group, signal.SIGKILL)
                            except ProcessLookupError:
                                pass
                        app.wait()
                if xvfb:
                    xvfb.terminate()
                    xvfb.wait(timeout=10)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    package = parser.add_mutually_exclusive_group(required=True)
    package.add_argument("--deb", type=Path)
    package.add_argument("--appimage", type=Path)
    parser.add_argument("--xvfb", type=Path, default=Path(".tools/xvfb/usr/bin/Xvfb"))
    parser.add_argument("--log-dir", type=Path, required=True)
    validate(parser.parse_args())
