from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterable

import uvicorn

from lrc_roller.config import DEFAULT_HOST, DEFAULT_PORT, Settings
from lrc_roller.main import create_app
from lrc_roller.services.runtime_manager import RuntimeManager
from lrc_roller.storage.app_settings import SettingsStore


def _repo_root() -> Path:
    """Best-effort source checkout root for development commands."""
    candidates = [Path.cwd(), Path(__file__).resolve().parents[2]]
    for candidate in candidates:
        if (candidate / "frontend" / "package.json").exists() and (candidate / "pyproject.toml").exists():
            return candidate
    return Path.cwd()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lrc-roller",
        description="Local WebUI frontend for py-roller and pylrclib. Running without a subcommand starts the server.",
    )
    subparsers = parser.add_subparsers(dest="command")

    serve = subparsers.add_parser("serve", help="Start the local lrc-roller backend/server")
    _add_serve_args(serve)

    dev = subparsers.add_parser("dev", help="Start backend on 6789 and Vite frontend on 5173")
    _add_serve_args(dev)
    dev.add_argument("--frontend-port", type=int, default=5173)
    dev.add_argument("--no-backend-reload", action="store_true", help="Disable uvicorn reload in dev mode")

    setup = subparsers.add_parser("setup", help="Install/check frontend and isolated Auto Timing runtime")
    setup.add_argument("--profile", choices=("auto", "cpu", "cu124"), default="auto", help="py-roller install profile")
    setup.add_argument("--skip-frontend", action="store_true", help="Do not run pnpm install")
    setup.add_argument("--skip-roller", action="store_true", help="Do not create/repair the isolated py-roller runtime")
    setup.add_argument("--skip-doctor", action="store_true", help="Pass --skip-doctor to py-roller install")
    setup.add_argument("--dry-run", action="store_true", help="Print commands without running them")

    doctor = subparsers.add_parser("doctor", help="Show lrc-roller, frontend, pylrclib, and isolated py-roller runtime status")
    doctor.add_argument("--run-pyroller-doctor", action="store_true", help="Also execute py-roller doctor inside the isolated runtime")
    doctor.add_argument("--profile", choices=("auto", "cpu", "cu124"), default=None, help="Runtime profile to inspect; defaults to saved settings")
    return parser


def _add_serve_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--data-dir", default=None)
    parser.add_argument(
        "--skip-port-check",
        action="store_true",
        help="Skip the friendly preflight port check and let uvicorn report bind errors.",
    )


def _port_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def _print_port_help(host: str, port: int) -> None:
    print(
        f"lrc-roller could not start because http://{host}:{port} is already in use.\n\n"
        "On macOS, find and stop the process with:\n"
        f"  lsof -nP -iTCP:{port} -sTCP:LISTEN\n"
        f"  kill <PID>\n\n"
        "Or temporarily use another port:\n"
        f"  lrc-roller serve --port {port + 1}\n",
        file=sys.stderr,
    )


def _settings_from_args(args: argparse.Namespace) -> Settings:
    settings = Settings.from_env()
    settings.host = args.host
    settings.port = args.port
    if getattr(args, "data_dir", None):
        settings.data_dir = Path(args.data_dir).expanduser()
    return settings


def _settings_env(settings: Settings) -> dict[str, str]:
    env = os.environ.copy()
    env["LRC_ROLLER_HOST"] = settings.host
    env["LRC_ROLLER_PORT"] = str(settings.port)
    env["LRC_ROLLER_DATA_DIR"] = str(settings.data_dir)
    if settings.frontend_dist is not None:
        env["LRC_ROLLER_FRONTEND_DIST"] = str(settings.frontend_dist)
    return env


def _apply_settings_env(settings: Settings) -> None:
    os.environ.update(_settings_env(settings))


def _serve(args: argparse.Namespace) -> int:
    settings = _settings_from_args(args)
    if not args.skip_port_check and not _port_available(settings.host, settings.port):
        _print_port_help(settings.host, settings.port)
        return 48
    if args.reload:
        # Uvicorn reload requires an import string; pass CLI settings through env so the reloader child sees them.
        _apply_settings_env(settings)
        uvicorn.run("lrc_roller.main:app", host=settings.host, port=settings.port, reload=True)
    else:
        uvicorn.run(create_app(settings), host=settings.host, port=settings.port)
    return 0


def _command_text(cmd: Iterable[str]) -> str:
    return " ".join(cmd)


def _run(cmd: list[str], *, cwd: Path | None = None, dry_run: bool = False) -> int:
    print("+", _command_text(cmd))
    if dry_run:
        return 0
    return subprocess.run(cmd, cwd=str(cwd) if cwd else None).returncode


def _setup(args: argparse.Namespace) -> int:
    root = _repo_root()
    if not args.skip_frontend:
        if shutil.which("pnpm") is None:
            print("pnpm is not on PATH. Install it first, for example: corepack enable && corepack prepare pnpm@latest --activate", file=sys.stderr)
            return 2
        code = _run(["pnpm", "install"], cwd=root, dry_run=args.dry_run)
        if code != 0:
            return code

    if not args.skip_roller:
        settings = Settings.from_env()
        cmd = [sys.executable, "-m", "lrc_roller.runtime_installer", "--data-dir", str(settings.data_dir), "--profile", args.profile]
        if args.skip_doctor:
            cmd.append("--skip-doctor")
        code = _run(cmd, dry_run=args.dry_run)
        if code != 0:
            return code
    return _doctor(argparse.Namespace(run_pyroller_doctor=not args.skip_roller and not args.dry_run, profile=args.profile))

def _package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def _print_row(name: str, value: str) -> None:
    print(f"{name:<22} {value}")


def _doctor(args: argparse.Namespace) -> int:
    root = _repo_root()
    _print_row("Python", sys.executable)
    _print_row("Working directory", str(Path.cwd()))
    _print_row("Source root", str(root))
    _print_row("lrc-roller", _package_version("lrc-roller") or "not installed")
    _print_row("pylrclib-cli", _package_version("pylrclib-cli") or "not installed")
    settings = Settings.from_env()
    runtime_settings = SettingsStore(settings.data_dir).read()
    runtime_profile = args.profile or runtime_settings.auto_roller_profile
    runtime_manager = RuntimeManager(settings.data_dir)
    runtime_info = runtime_manager.inspect(runtime_profile)
    _print_row("py-roller (backend)", _package_version("py-roller") or "not installed")
    _print_row("py-roller CLI (PATH)", shutil.which("py-roller") or "not found")
    _print_row("runtime profile", runtime_profile)
    _print_row("runtime status", runtime_info.status)
    _print_row("runtime id", runtime_info.runtime_id)
    _print_row("runtime python", str(runtime_info.python_path))
    _print_row("runtime py-roller", runtime_info.version or "not installed")
    _print_row("node", shutil.which("node") or "not found")
    _print_row("pnpm", shutil.which("pnpm") or "not found")
    _print_row("frontend package", "yes" if (root / "frontend" / "package.json").exists() else "not found")
    _print_row("frontend node_modules", "yes" if (root / "frontend" / "node_modules").exists() else "not found")

    try:
        import lrc_roller

        _print_row("lrc_roller module", str(Path(lrc_roller.__file__).resolve()))
    except Exception as exc:
        _print_row("lrc_roller module", f"import failed: {exc.__class__.__name__}: {exc}")

    if args.run_pyroller_doctor:
        if not runtime_info.ready:
            print("\nCannot run py-roller doctor: isolated runtime is not ready.", file=sys.stderr)
            return 1
        print("\npy-roller doctor (isolated runtime):")
        result = subprocess.run(
            runtime_manager.doctor_command(runtime_profile),
            cwd=str(runtime_info.runtime_root),
            text=True,
            capture_output=True,
            env=runtime_manager.runtime_env(runtime_info.venv_path),
        )
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict):
            for check in payload.get("checks", []):
                if isinstance(check, dict):
                    status = str(check.get("status", "")).upper()
                    name = str(check.get("name", "check"))
                    message = str(check.get("message", ""))
                    print(f"[{status:<4}] {name:<18} {message}")
        else:
            print(result.stdout, end="")
        if result.stderr:
            print(result.stderr, end="", file=sys.stderr)
        return result.returncode
    return 0

def _dev(args: argparse.Namespace) -> int:
    root = _repo_root()
    settings = _settings_from_args(args)
    if shutil.which("pnpm") is None:
        print("pnpm is not on PATH. Run: corepack enable && corepack prepare pnpm@latest --activate", file=sys.stderr)
        return 2
    if not (root / "frontend" / "package.json").exists():
        print("Cannot find frontend/package.json. Run lrc-roller dev from the source checkout.", file=sys.stderr)
        return 2
    if not args.skip_port_check and not _port_available(settings.host, settings.port):
        _print_port_help(settings.host, settings.port)
        return 48

    backend_cmd = [sys.executable, "-m", "uvicorn", "lrc_roller.main:app", "--host", settings.host, "--port", str(settings.port)]
    if not args.no_backend_reload:
        backend_cmd.append("--reload")
    frontend_cmd = ["pnpm", "-C", "frontend", "start", "--host", "127.0.0.1", "--port", str(args.frontend_port)]

    print("Starting lrc-roller dev stack:")
    print("+", _command_text(backend_cmd))
    print("+", _command_text(frontend_cmd))
    backend = subprocess.Popen(backend_cmd, cwd=str(root), env=_settings_env(settings))
    time.sleep(0.8)
    frontend = subprocess.Popen(frontend_cmd, cwd=str(root))
    try:
        while True:
            b = backend.poll()
            f = frontend.poll()
            if b is not None:
                return b
            if f is not None:
                return f
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopping lrc-roller dev stack...")
        for proc in (frontend, backend):
            if proc.poll() is None:
                proc.terminate()
        for proc in (frontend, backend):
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        return 130


def main() -> None:
    parser = build_parser()
    raw_args = sys.argv[1:]
    if not raw_args:
        raw_args = ["serve"]
    args = parser.parse_args(raw_args)
    if args.command == "serve":
        raise SystemExit(_serve(args))
    if args.command == "dev":
        raise SystemExit(_dev(args))
    if args.command == "setup":
        raise SystemExit(_setup(args))
    if args.command == "doctor":
        raise SystemExit(_doctor(args))
    parser.error(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()
