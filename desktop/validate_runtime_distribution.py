"""Validate the lean runtime offline in isolated relocated directories, without GUI or models."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from prepare_python_runtime import cached_source


def validate(runtime: Path, engine: Path):
    runtime, engine = runtime.resolve(), engine.resolve()
    assert not (runtime / "bin" / "python").exists()
    assert not (runtime / "bin" / "python3").exists()
    assert not any(cached_source(path) for path in runtime.rglob("*.pyc"))
    with tempfile.TemporaryDirectory(prefix="rollingpebble-lean-runtime-") as temporary:
        root = Path(temporary)
        moved = root / "relocated Python 运行环境"
        shutil.copytree(runtime, moved, symlinks=True)
        home = root / "home"
        home.mkdir()
        env = dict(PATH="/usr/bin:/bin", HOME=str(home), TMPDIR=str(root),
                   PYTHONNOUSERSITE="1", PYTHONDONTWRITEBYTECODE="1",
                   PIP_CONFIG_FILE=os.devnull, PIP_DISABLE_PIP_VERSION_CHECK="1", PIP_NO_CACHE_DIR="1",
                   XDG_CACHE_HOME=str(root / "cache"), TORCH_HOME=str(root / "torch"),
                   HF_HOME=str(root / "huggingface"), HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                   PHONEMIZER_ESPEAK_LIBRARY=str(engine / "espeak" / "libespeak-ng.1.dylib"),
                   ESPEAK_DATA_PATH=str(engine / "espeak"))
        python = moved / "bin" / "python3.12"
        subprocess.run([str(python), "-I", "-B", "-c", "import ssl,venv,ensurepip; print(ssl.OPENSSL_VERSION)"], env=env, check=True)
        venv = root / "venv 工程"
        subprocess.run([str(python), "-I", "-B", "-m", "venv", "--copies", str(venv)], env=env, check=True)
        python = venv / "bin" / "python"
        env["PATH"] = f"{venv / 'bin'}:{engine / 'bin'}:/usr/bin:/bin"
        subprocess.run([str(python), "-B", "-m", "pip", "install", "--no-index", "--no-cache-dir", "--require-hashes",
                        "--find-links", str(engine / "wheels"), "-r", str(engine / "vocals.txt")], env=env, check=True)
        subprocess.run([str(python), "-B", "-m", "pip", "check"], env=env, check=True)
        for language in ("en", "zh", "mul"):
            result = subprocess.run([str(python), "-B", "-m", "pyroller", "doctor", "--json",
                                     "--cache-dir", str(root / "models"), "--language", language, "--audio-mode", "vocals"],
                                    env=env, capture_output=True, text=True, timeout=180)
            report = json.loads(result.stdout)
            assert result.returncode in (0, 1) and report.get("runtime_ok"), report
            print(f"Offline runtime doctor passed: {language}", flush=True)
        subprocess.run([str(python), "-B", str(Path(__file__).with_name("validate_pronunciation.py")),
                        "--python", str(python), "--components", str(engine / "espeak")], env=env, check=True)
        print("Lean runtime: relocation, SSL, venv, pip, offline base/Vocals and multilingual components passed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, default=Path("desktop/python-runtime"))
    parser.add_argument("--engine", type=Path, default=Path("desktop/engine"))
    args = parser.parse_args()
    validate(args.runtime, args.engine)
