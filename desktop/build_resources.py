from __future__ import annotations

import subprocess
from pathlib import Path

from prepare_python_runtime import FULL_RUNTIME_ROOT, TARGET_ROOT, prepare_full_runtime, prepare_distribution


ROOT = Path(__file__).resolve().parents[1]
BUILD_ENV = ROOT / "build" / "desktop-build-venv"


def prepare_build_python() -> Path:
    python = BUILD_ENV / "bin" / "python"
    if not python.is_file():
        subprocess.run(
            [str(FULL_RUNTIME_ROOT / "bin" / "python3.12"), "-m", "venv", str(BUILD_ENV)],
            check=True,
        )
    base_prefix = subprocess.check_output(
        [str(python), "-I", "-c", "import sys; print(sys.base_prefix)"], text=True,
    ).strip()
    if Path(base_prefix).resolve() != FULL_RUNTIME_ROOT.resolve():
        raise RuntimeError(f"Desktop build environment must use bundled Python: {BUILD_ENV}")
    subprocess.run(
        [str(python), "-m", "pip", "install", "--only-binary=:all:",
         "PyInstaller==6.22.3", str(ROOT)],
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
            str(ROOT / "desktop" / "rollingpebble_backend.py"),
        ],
        cwd=ROOT,
        check=True,
    )
    prepare_distribution()
    subprocess.run(
        [str(python), str(ROOT / "desktop" / "audit_native.py"),
         str(ROOT / "desktop" / "bin" / "rollingpebble-backend"), str(TARGET_ROOT)],
        check=True,
    )


if __name__ == "__main__":
    main()
