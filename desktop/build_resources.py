from __future__ import annotations

import subprocess
import shutil
import sys
from pathlib import Path

from prepare_python_runtime import FULL_RUNTIME_ROOT, TARGET_ROOT, prepare_full_runtime, prepare_distribution, runtime_executable


ROOT = Path(__file__).resolve().parents[1]
BUILD_ENV = ROOT / "build" / "desktop-build-venv"


def prepare_build_python() -> Path:
    python = BUILD_ENV / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    if not python.is_file():
        subprocess.run(
            [str(runtime_executable(FULL_RUNTIME_ROOT)), "-m", "venv", str(BUILD_ENV)],
            check=True,
        )
    base_prefix = subprocess.check_output(
        [str(python), "-I", "-c", "import sys; print(sys.base_prefix)"], text=True,
    ).strip()
    if Path(base_prefix).resolve() != FULL_RUNTIME_ROOT.resolve():
        raise RuntimeError(f"Desktop build environment must use bundled Python: {BUILD_ENV}")
    subprocess.run(
        [str(python), "-m", "pip", "install", "--only-binary=:all:",
         "PyInstaller==6.22.3", "pefile==2024.8.26", str(ROOT)],
        check=True,
    )

    return python


def main() -> None:
    prepare_full_runtime()
    python = prepare_build_python()
    from prepare_engine import prepare as prepare_engine
    prepare_engine(python)
    frontend = ROOT / "frontend" / "dist"
    if not (frontend / "index.html").is_file():
        raise RuntimeError("Build the frontend before preparing desktop resources")
    subprocess.run(
        [
            str(python), "-m", "PyInstaller",
            "--name", "rollingpebble-backend", "--onefile", "--noconfirm", "--clean",
            "--paths", str(ROOT / "backend"),
            "--copy-metadata", "rollingpebble",
            "--collect-submodules", "keyring.backends",
            "--copy-metadata", "keyring",
            "--distpath", str(ROOT / "desktop" / "bin"),
            "--workpath", str(ROOT / "build" / "pyinstaller"),
            "--specpath", str(ROOT / "build" / "pyinstaller"),
            "--add-data", f"{frontend}:rollingpebble/frontend_dist",
            *(["--manifest", str(ROOT / "desktop" / "windows-backend.manifest")] if sys.platform == "win32" else []),
            str(ROOT / "desktop" / "rollingpebble_backend.py"),
        ],
        cwd=ROOT,
        check=True,
    )
    prepare_distribution()
    if sys.platform == "win32":
        # Tauri keys resources by source path. Distinct source files are needed
        # when the CRT is installed beside both Tauri and standalone Python.
        native_crt = ROOT / "desktop" / "bin" / "windows-runtime"
        native_crt.mkdir(parents=True, exist_ok=True)
        for name in ("vcruntime140.dll", "vcruntime140_1.dll"):
            shutil.copy2(TARGET_ROOT / name, native_crt / name)
    subprocess.run(
        [str(python), str(ROOT / "desktop" / "audit_native.py"),
         str(ROOT / "desktop" / "bin" / ("rollingpebble-backend.exe" if sys.platform == "win32" else "rollingpebble-backend")), str(TARGET_ROOT)],
        check=True,
    )


if __name__ == "__main__":
    main()
