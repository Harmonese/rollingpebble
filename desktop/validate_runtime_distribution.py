"""Validate the lean runtime offline in isolated relocated directories, without GUI or models."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
import shutil
import subprocess
import tempfile
import wave

from prepare_python_runtime import cached_source, runtime_executable, TARGET


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
                   PHONEMIZER_ESPEAK_LIBRARY=str(engine / "espeak" / ("libespeak-ng.1.dylib" if sys.platform == "darwin" else "libespeak-ng.so.1")),
                   ESPEAK_DATA_PATH=str(engine / "espeak"))
        if sys.platform == "win32":
            env.update({k: v for k, v in os.environ.items() if k.upper() in {"SYSTEMROOT", "WINDIR", "COMSPEC"}})
            env.update(PATH=str(Path(os.environ["SystemRoot"]) / "System32"),
                       TEMP=str(root), TMP=str(root), USERPROFILE=str(home),
                       APPDATA=str(home / "AppData/Roaming"), LOCALAPPDATA=str(home / "AppData/Local"),
                       PYTHONUTF8="1")
        env["PHONEMIZER_ESPEAK_LIBRARY"] = str(engine / "espeak" / TARGET["espeak_library"])
        audio, converted = root / "音频输入.wav", root / "音频输出.flac"
        with wave.open(str(audio), "wb") as output:
            output.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            output.writeframes(b"\0\0" * 16000)
        ffmpeg = engine / "bin" / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
        subprocess.run([str(ffmpeg), "-hide_banner", "-loglevel", "error", "-i", str(audio),
                        "-c:a", "flac", str(converted)], env=env, check=True)
        assert converted.read_bytes().startswith(b"fLaC")
        python = runtime_executable(moved)
        subprocess.run([str(python), "-I", "-B", "-c", "import ssl,venv,ensurepip; print(ssl.OPENSSL_VERSION)"], env=env, check=True)
        if sys.platform == "win32":
            subprocess.run([str(python), "-I", "-B", "-c", "import ctypes; assert ctypes.windll.kernel32.GetACP() == 65001"], env=env, check=True)
        venv = root / "venv 工程"
        subprocess.run([str(python), "-I", "-B", "-m", "venv", "--copies", str(venv)], env=env, check=True)
        python = venv / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
        env["PATH"] = os.pathsep.join((str(python.parent), str(engine / "bin"), env["PATH"]))
        subprocess.run([str(python), "-B", "-m", "pip", "install", "--no-index", "--no-cache-dir", "--require-hashes",
                        "--find-links", str(engine / "wheels"), "-r", str(engine / "vocals.txt")], env=env, check=True)
        subprocess.run([str(python), "-B", "-m", "pip", "check"], env=env, check=True)
        if sys.platform == "win32":
            script = """
import ctypes
from pathlib import Path
import torch
from pyroller.hybrid import _alignment
k = ctypes.WinDLL('kernel32', use_last_error=True)
k.GetModuleHandleW.argtypes = [ctypes.c_wchar_p]
k.GetModuleHandleW.restype = ctypes.c_void_p
k.GetModuleFileNameW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint]
path = ctypes.create_unicode_buffer(32768)
assert k.GetModuleFileNameW(k.GetModuleHandleW('msvcp140.dll'), path, len(path))
import sys
assert Path(path.value).resolve().parent == Path(sys.base_prefix).resolve(), path.value
print('Native C++ engine uses the bundled app-local Microsoft runtime.')
"""
            subprocess.run([str(python), "-B", "-c", script], env=env, check=True)
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
