from __future__ import annotations

import subprocess
from pathlib import Path

from prepare_python_runtime import TARGET_ROOT, prepare


ROOT = Path(__file__).resolve().parents[1]
BUILD_ENV = ROOT / "build" / "desktop-venv"


def prepare_build_python() -> Path:
    python = BUILD_ENV / "bin" / "python"
    if not python.is_file():
        subprocess.run(
            [str(TARGET_ROOT / "bin" / "python3.12"), "-m", "venv", str(BUILD_ENV)],
            check=True,
        )
    base_prefix = subprocess.check_output(
        [str(python), "-I", "-c", "import sys; print(sys.base_prefix)"], text=True,
    ).strip()
    if Path(base_prefix).resolve() != TARGET_ROOT.resolve():
        raise RuntimeError(f"Desktop build environment must use bundled Python: {BUILD_ENV}")
    subprocess.run(
        [str(python), "-m", "pip", "install", "--only-binary=:all:",
         "PyInstaller==6.22.3", str(ROOT)],
        check=True,
    )

    return python


def main() -> None:
    prepare()
    python = prepare_build_python()
    frontend = ROOT / "frontend" / "dist"
    if not (frontend / "index.html").is_file():
        raise RuntimeError("Build the frontend before preparing desktop resources")
    subprocess.run(
        [
            str(python), "-m", "PyInstaller",
            "--name", "rollingpebble-backend", "--onefile", "--noconfirm", "--clean",
            "--paths", str(ROOT / "backend"),
            "--copy-metadata", "rollingpebble",
            "--distpath", str(ROOT / "desktop" / "bin"),
            "--workpath", str(ROOT / "build" / "pyinstaller"),
            "--specpath", str(ROOT / "build" / "pyinstaller"),
            "--add-data", f"{frontend}:rollingpebble/frontend_dist",
            str(ROOT / "desktop" / "rollingpebble_backend.py"),
        ],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        [str(python), str(ROOT / "desktop" / "audit_macos.py"),
         str(ROOT / "desktop" / "bin" / "rollingpebble-backend"), str(TARGET_ROOT)],
        check=True,
    )


if __name__ == "__main__":
    main()
