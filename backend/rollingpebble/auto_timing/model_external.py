"""External paths use the public engine inventory, never managed-weight hashes."""
import json
import subprocess
from pathlib import Path

from rollingpebble.auto_timing.model_download import check_cancel


def external_signature(value):
    path = Path(value).expanduser()
    if not path.is_dir():
        return (str(path), None)
    return (str(path.resolve()), tuple(sorted(
        (p.name, p.stat().st_size, p.stat().st_mtime_ns, p.stat().st_ctime_ns)
        for p in path.iterdir() if p.is_file())))


def inspect_external(manager, kind, path, cancel):
    command = [*manager.command_prefix("auto"), "models", "list", "--json", "--kind", kind,
               "--cache-dir", str(manager.engine_data()), "--" + kind + "-model", path]
    env = manager.runtime_env(manager.venv_path("auto"))
    env.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, text=True)
    try:
        for _ in range(150):
            check_cancel(cancel)
            try:
                stdout, _ = process.communicate(timeout=.2)
                if process.returncode:
                    return False
                report = json.loads(stdout)
                return report.get("engine") == "py-roller" and any(
                    m.get("kind") == kind and m.get("available") for m in report.get("models", []))
            except subprocess.TimeoutExpired:
                continue
        return False
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
