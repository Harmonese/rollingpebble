"""Create a new engine generation from binary wheels, never compile on the desktop."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import shutil
from pathlib import Path

from rollingpebble.auto_timing.protocol import compatible
from rollingpebble.auto_timing.store import atomic_json
from rollingpebble.paths import ensure_storage_layout
from rollingpebble.runtime.environment import build_runtime_env, runtime_python_path
from rollingpebble.runtime.python import RuntimePython, prepare_bundled_runtime
from rollingpebble.storage.app_settings import SettingsStore


def engine_resources() -> Path | None:
    root = os.environ.get("ROLLINGPEBBLE_APP_RESOURCES")
    if root:
        path = Path(root) / "engine"
        return path if path.is_dir() else None
    path = Path(__file__).resolve().parents[3] / "desktop" / "engine"
    return path if path.is_dir() else None


def bundle_fingerprint() -> str:
    resources = engine_resources()
    if resources is None:
        raise RuntimeError("Bundled engine wheels are missing")
    digest = hashlib.sha256()
    for name in ("manifest.json", "requirements.txt", "vocals.txt"):
        digest.update((resources / name).read_bytes())
    return digest.hexdigest()


def install_runtime(data_dir: Path, profile: str = "auto", skip_doctor: bool = False, *,
                    vocals: bool = False, ensure: bool = False, repair: bool = False) -> None:
    if profile != "auto":
        raise ValueError("Runtime components are managed by the application")
    layout = ensure_storage_layout(data_dir, SettingsStore(data_dir).read())
    fingerprint = bundle_fingerprint()
    bundled = prepare_bundled_runtime(data_dir)
    if bundled is None:
        raise RuntimeError("Bundled Python is missing. Reinstall the application.")
    python = RuntimePython(str(bundled), 3, 12)
    runtime_id = "managed"
    root = layout.runtime_root
    if root.is_symlink():
        raise RuntimeError("Managed environment must not be a symbolic link")
    venv = root / "venv"
    root.mkdir(parents=True, exist_ok=True)
    try:
        previous = json.loads((root / "runtime.json").read_text())
        if not isinstance(previous, dict):
            previous = {}
    except (OSError, ValueError):
        previous = {}
    # A previous interrupted installation must not be adopted as a healthy environment.
    interrupted = previous.get("last_install_status") == "running"
    payload = dict(previous, runtime_id=runtime_id, profile="auto", last_install_status="running",
                   preparation_phase="checking")
    atomic_json(root / "runtime.json", payload)
    try:
        executable = runtime_python_path(venv)
        if repair or interrupted:
            payload["preparation_phase"] = "preparing"
            atomic_json(root / "runtime.json", payload)
            if venv.is_symlink():
                raise RuntimeError("Managed environment must not be a symbolic link")
            if venv.exists():
                shutil.rmtree(venv)
        if not executable.exists():
            payload["preparation_phase"] = "preparing"
            atomic_json(root / "runtime.json", payload)
            subprocess.run([python.executable, "-m", "venv", str(venv)], check=True)
        env = build_runtime_env(venv, layout)
        resources = engine_resources()
        if not resources or not (resources / "requirements.txt").is_file():
            raise RuntimeError("Bundled engine wheels are missing. Build desktop/engine before installation.")
        command = [str(executable), "-m", "pip", "install", "--no-index", "--no-cache-dir", "--only-binary=:all:",
                   "--require-hashes", "--find-links", str(resources / "wheels"),
                   "-r", str(resources / ("vocals.txt" if vocals else "requirements.txt"))]
        def check_runtime(language="en", audio_mode=None):
            checked = subprocess.run([str(executable), "-m", "pyroller", "doctor", "--json", "--cache-dir",
                                     str(layout.engine_root),
                                     "--audio-mode", audio_mode or ("vocals" if vocals else "mix"), "--language", language],
                                    capture_output=True, text=True, env=env, timeout=120)
            try:
                result = json.loads(checked.stdout)
            except ValueError:
                return None
            if (checked.returncode in (0, 1) and result.get("runtime_ok")
                    and compatible(result.get("engine_version"))
                    and 2 in result.get("capabilities", {}).get("protocol_versions", [])):
                return result
            return None

        reuse = (ensure and not repair and not interrupted
                 and previous.get("bundle_fingerprint") in (None, fingerprint))
        doctor = check_runtime() if reuse else None
        if doctor and previous.get("bundle_fingerprint") is None:
            # Adopt a legacy environment only if its actual package versions match the bundle.
            script = "import importlib.metadata as m,json; print(json.dumps({d.metadata['Name'].lower().replace('_','-'):d.version for d in m.distributions()}))"
            installed = subprocess.run([str(executable), "-c", script], capture_output=True, text=True, env=env, check=True)
            versions = json.loads(installed.stdout)
            for line in (resources / ("vocals.txt" if vocals else "requirements.txt")).read_text().splitlines():
                name, version = line.split()[0].split("==")
                if versions.get(name.lower().replace("_", "-")) != version:
                    doctor = None
                    break
        if not doctor:
            payload["preparation_phase"] = "preparing"
            atomic_json(root / "runtime.json", payload)
            try:
                subprocess.run(command, env=env, check=True)
            except subprocess.CalledProcessError:
                if not vocals or check_runtime(audio_mode="mix") is None:
                    raise
            payload["preparation_phase"] = "checking"
            atomic_json(root / "runtime.json", payload)
            doctor = check_runtime()
        vocals_ready = bool(doctor) and vocals
        if not doctor and vocals:
            doctor = check_runtime(audio_mode="mix")
        if not doctor:
            raise RuntimeError("Engine runtime check failed")
        subprocess.run([str(executable), "-m", "pip", "check"], env=env, check=True)
        payload.update(pyroller_version=doctor.get("engine_version"), doctor_report=doctor,
                       pyroller_source="bundled:py-roller==0.10.3", last_doctor_status="ok" if doctor.get("runtime_ok") else "failed")
        if not doctor.get("runtime_ok") or not compatible(doctor.get("engine_version")):
            raise RuntimeError("Engine runtime check failed")
        payload["last_install_status"] = "ok"
        payload["preparation_phase"] = "ready"
        capabilities = {"original"}
        if vocals_ready:
            capabilities.add("vocals")
        try:
            multilingual = check_runtime("mul", audio_mode="mix")
        except (OSError, subprocess.TimeoutExpired):
            multilingual = None
        if multilingual:
            capabilities.add("multilingual")
        payload["multilingual_ready"] = bool(multilingual)
        payload.update(bundle_fingerprint=fingerprint, prepared_capabilities=sorted(capabilities))
        from rollingpebble.storage.transition import finish_layout_transition
        finish_layout_transition(data_dir)
    except BaseException as exc:
        payload.update(last_install_status="failed", last_install_error=str(exc), preparation_phase="failed")
        raise
    finally:
        atomic_json(root / "runtime.json", payload)
        print(json.dumps(payload), flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--profile", default="auto")
    parser.add_argument("--skip-doctor", action="store_true")
    parser.add_argument("--vocals", action="store_true")
    parser.add_argument("--ensure", action="store_true")
    parser.add_argument("--repair", action="store_true")
    args = parser.parse_args(argv)
    install_runtime(Path(args.data_dir), args.profile, args.skip_doctor, vocals=args.vocals,
                    ensure=args.ensure, repair=args.repair)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
