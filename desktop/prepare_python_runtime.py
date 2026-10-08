from __future__ import annotations

import hashlib
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path


VERSION = "3.12.15"
RELEASE = "20261003"
ARCHIVE_NAME = f"cpython-{VERSION}+{RELEASE}-aarch64-apple-darwin-install_only.tar.gz"
ARCHIVE_URL = (
    "https://github.com/astral-sh/python-build-standalone/releases/download/"
    f"{RELEASE}/{ARCHIVE_NAME.replace('+', '%2B')}"
)
ARCHIVE_SHA256 = "316a463172740e71d8dca1f2730784e325f3f720941137b5d674d5801a632213"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
TARGET_ROOT = PROJECT_ROOT / "desktop" / "python-runtime"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _is_ready(root: Path) -> bool:
    python = root / "bin" / "python3.12"
    if not python.is_file():
        return False
    result = subprocess.run([str(python), "-I", "-c", "import platform; print(platform.python_version())"],
                            capture_output=True, text=True, timeout=15)
    return result.returncode == 0 and result.stdout.strip() == VERSION


def prepare() -> None:
    if _is_ready(TARGET_ROOT):
        print(f"Bundled Python runtime already prepared: {TARGET_ROOT}")
        return

    with tempfile.TemporaryDirectory(prefix="rollingpebble-python-") as temporary:
        archive = Path(temporary) / ARCHIVE_NAME
        print(f"Downloading bundled Python {VERSION} for macOS arm64...")
        urllib.request.urlretrieve(ARCHIVE_URL, archive)
        actual_sha256 = _sha256(archive)
        if actual_sha256 != ARCHIVE_SHA256:
            raise RuntimeError(
                f"Bundled Python checksum mismatch: expected {ARCHIVE_SHA256}, got {actual_sha256}"
            )

        extracted = Path(temporary) / "extracted"
        extracted.mkdir()
        with tarfile.open(archive, "r:gz") as package:
            package.extractall(extracted, filter="data")

        if not _is_ready(extracted / "python"):
            raise RuntimeError("Bundled Python archive did not contain python/bin/python3.12")

        TARGET_ROOT.parent.mkdir(parents=True, exist_ok=True)
        staging = TARGET_ROOT.with_name(f".{TARGET_ROOT.name}.staging")
        if staging.exists():
            shutil.rmtree(staging)
        (extracted / "python").replace(staging)
        if TARGET_ROOT.exists():
            shutil.rmtree(TARGET_ROOT)
        staging.replace(TARGET_ROOT)
        print(f"Prepared bundled Python runtime: {TARGET_ROOT}")


if __name__ == "__main__":
    if sys.platform != "darwin" or platform.machine() != "arm64":
        raise SystemExit("This bundled runtime preparation script targets macOS arm64.")
    prepare()
