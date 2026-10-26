"""Build the pinned phonemizer library and data without end-user system dependencies."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "build" / "espeak-bundle"
SOURCE_URL = "https://codeload.github.com/espeak-ng/espeak-ng/tar.gz/refs/tags/1.52.0"
SOURCE_SHA256 = "bb4338102ff3b49a81423da8a1a158b420124b055b60fa76cfb4b18677130a23"
FLAGS = ["-DBUILD_SHARED_LIBS=ON", "-DBUILD_TESTING=OFF", "-DUSE_MBROLA=OFF",
         "-DUSE_LIBSONIC=OFF", "-DUSE_LIBPCAUDIO=OFF", "-DUSE_ASYNC=OFF",
         "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_OSX_ARCHITECTURES=arm64",
         "-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0", "-DCMAKE_C_FLAGS=-DN_PATH_HOME=4096", "-DCMAKE_C_COMPILER=/usr/bin/clang",
         "-DCMAKE_CXX_COMPILER=/usr/bin/clang++", "-DCMAKE_INSTALL_PREFIX=/rollingpebble-components"]

if sys.platform == "linux":
    FLAGS = [flag for flag in FLAGS if not flag.startswith(("-DCMAKE_OSX_", "-DCMAKE_C_COMPILER=", "-DCMAKE_CXX_COMPILER="))]


def prepare():
    manifest = DEST / "manifest.json"
    if manifest.exists():
        data = json.loads(manifest.read_text())
        if data.get("flags") == FLAGS and all(
            (DEST / name).is_file() and hashlib.sha256((DEST / name).read_bytes()).hexdigest() == digest
            for name, digest in data["files"].items()
        ):
            return DEST
    with tempfile.TemporaryDirectory(prefix="rollingpebble-espeak-") as temporary:
        stage = Path(temporary)
        archive = stage / "espeak-ng-1.52.0.tar.gz"
        cached = Path(tempfile.gettempdir()) / "rp-espeak-ng-1.52.0.tar.gz"
        if cached.exists():
            shutil.copy2(cached, archive)
        else:
            subprocess.run(["curl", "--fail", "--location", "--retry", "3", "--output", str(archive), SOURCE_URL], check=True)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != SOURCE_SHA256:
            raise RuntimeError("eSpeak source checksum mismatch")
        with tarfile.open(archive) as source:
            source.extractall(stage, filter="data")
        source = stage / "espeak-ng-1.52.0"
        build = stage / "build"
        env = {**os.environ, "MACOSX_DEPLOYMENT_TARGET": "14.0"}
        subprocess.run(["cmake", "-S", str(source), "-B", str(build), *FLAGS], env=env, check=True)
        subprocess.run(["cmake", "--build", str(build), "--parallel", "8"], env=env, check=True)
        if DEST.exists():
            shutil.rmtree(DEST)
        DEST.mkdir(parents=True)
        if sys.platform == "darwin":
            library = DEST / "libespeak-ng.1.dylib"
            shutil.copy2(next(build.rglob("libespeak-ng.1.52.0.dylib")), library)
            subprocess.run(["install_name_tool", "-id", "@rpath/libespeak-ng.1.dylib", str(library)], check=True)
            subprocess.run(["codesign", "--force", "--sign", "-", str(library)], check=True)
        else:
            library = DEST / "libespeak-ng.so.1"
            shutil.copy2(next(build.rglob("libespeak-ng.so.1.52.0")), library)
        from audit_native import audit_binary
        audit_binary(library, (14, 0, 0))
        shutil.copytree(build / "espeak-ng-data", DEST / "espeak-ng-data")
        shutil.copy2(archive, DEST / archive.name)
        for name in ("COPYING", "COPYING.APACHE", "COPYING.BSD2", "COPYING.UCD"):
            if (source / name).is_file():
                shutil.copy2(source / name, DEST / name)
        (DEST / "BUILD.txt").write_text(SOURCE_URL + "\nSHA-256: " + SOURCE_SHA256 + "\n" + json.dumps(FLAGS, indent=2))
        files = {str(p.relative_to(DEST)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in DEST.rglob("*") if p.is_file()}
        manifest.write_text(json.dumps(dict(source=SOURCE_URL, flags=FLAGS, files=files), indent=2))
    return DEST


if __name__ == "__main__":
    prepare()
