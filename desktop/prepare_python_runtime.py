from __future__ import annotations

import hashlib
import importlib.util
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
FULL_RUNTIME_ROOT = PROJECT_ROOT / "build" / "python-build-runtime"
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
    result = subprocess.run([str(python), "-I", "-B", "-c", "import platform; print(platform.python_version())"],
                            capture_output=True, text=True, timeout=15)
    return result.returncode == 0 and result.stdout.strip() == VERSION


def prepare_full_runtime() -> None:
    if _is_ready(FULL_RUNTIME_ROOT):
        print(f"Bundled Python runtime already prepared: {FULL_RUNTIME_ROOT}")
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

        FULL_RUNTIME_ROOT.parent.mkdir(parents=True, exist_ok=True)
        staging = FULL_RUNTIME_ROOT.with_name(f".{FULL_RUNTIME_ROOT.name}.staging")
        if staging.exists():
            shutil.rmtree(staging)
        (extracted / "python").replace(staging)
        if FULL_RUNTIME_ROOT.exists():
            shutil.rmtree(FULL_RUNTIME_ROOT)
        staging.replace(FULL_RUNTIME_ROOT)
        print(f"Prepared bundled Python runtime: {FULL_RUNTIME_ROOT}")


def cached_source(path: Path) -> Path | None:
    if path.suffix != ".pyc" or not path.is_file():
        return None
    try:
        source = Path(importlib.util.source_from_cache(str(path)))
    except ValueError:
        source = path.with_suffix(".py")
    return source if source.is_file() else None


def prepare_distribution(source: Path = FULL_RUNTIME_ROOT, target: Path = TARGET_ROOT) -> None:
    source_root, target_root = source.resolve(), target.resolve()
    if source_root == target_root or source_root in target_root.parents or target_root in source_root.parents or target.is_symlink():
        raise RuntimeError("Build cache and distribution must be separate directories")
    canonical = source / "bin" / "python3.12"
    if not canonical.is_file() or canonical.is_symlink():
        raise RuntimeError("Distribution requires a real python3.12 executable")
    excluded = set()
    for name in ("python", "python3"):
        alias = source / "bin" / name
        if alias.exists() or alias.is_symlink():
            if alias.resolve() != canonical.resolve() and (not alias.is_file() or _sha256(alias) != _sha256(canonical)):
                raise RuntimeError(f"Unexpected Python alias: {alias}")
            excluded.add(alias)
    def ignore(folder, names):
        return [name for name in names if Path(folder) / name in excluded or cached_source(Path(folder) / name)]
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".python-dist-", dir=target.parent) as temporary:
        staged = Path(temporary) / "runtime"
        shutil.copytree(source, staged, symlinks=True, ignore=ignore)
        if not _is_ready(staged):
            raise RuntimeError("Pruned Python failed validation")
        if target.exists():
            shutil.rmtree(target)
        staged.replace(target)
    print(f"Prepared lean bundled runtime: {target}")


def prepare() -> None:
    prepare_full_runtime()
    prepare_distribution()


if __name__ == "__main__":
    if sys.platform != "darwin" or platform.machine() != "arm64":
        raise SystemExit("This bundled runtime preparation script targets macOS arm64.")
    prepare()
