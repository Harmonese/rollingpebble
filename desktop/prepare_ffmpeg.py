"""Build a standalone LGPL FFmpeg on the build machine, with corresponding source."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "desktop" / "ffmpeg"
SOURCE_URL = "https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz"
SOURCE_SHA256 = "40973d44970dbc83ef302b0609f2e74982be2d85916dd2ee7472d30678a7abe6"
FLAGS = ["--cc=/usr/bin/clang", "--arch=arm64", "--target-os=darwin",
         "--extra-cflags=-mmacosx-version-min=14.0", "--extra-ldflags=-mmacosx-version-min=14.0",
         "--disable-autodetect", "--disable-gpl", "--disable-nonfree", "--disable-network",
         "--disable-shared", "--enable-static", "--disable-doc", "--disable-debug",
         "--disable-ffplay", "--disable-ffprobe", "--disable-devices", "--disable-encoders",
         "--enable-encoder=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,flac",
         "--disable-videotoolbox", "--enable-small"]


def prepare():
    manifest = DEST / "manifest.json"
    if manifest.exists():
        record = json.loads(manifest.read_text())
        if record.get("flags") == FLAGS and all(
            (DEST / name).is_file() and hashlib.sha256((DEST / name).read_bytes()).hexdigest() == digest
            for name, digest in record["files"].items()
        ):
            return DEST
    with tempfile.TemporaryDirectory(prefix="rollingpebble-ffmpeg-") as temporary:
        stage = Path(temporary)
        archive = stage / "ffmpeg-7.1.tar.xz"
        cached = Path(tempfile.gettempdir()) / "rollingpebble-ffmpeg-7.1.tar.xz"
        if cached.exists():
            shutil.copy2(cached, archive)
        else:
            urllib.request.urlretrieve(SOURCE_URL, archive)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != SOURCE_SHA256:
            raise RuntimeError("FFmpeg source checksum mismatch")
        with tarfile.open(archive) as source:
            source.extractall(stage, filter="data")
        source = stage / "ffmpeg-7.1"
        env = {**os.environ, "MACOSX_DEPLOYMENT_TARGET": "14.0", "SOURCE_DATE_EPOCH": "1727654400"}
        subprocess.run([str(source / "configure"), *FLAGS], cwd=source, env=env, check=True)
        subprocess.run(["/usr/bin/make", "-j", str(min(os.cpu_count() or 4, 8)), "ffmpeg"], cwd=source, env=env, check=True)
        from audit_macos import audit_binary
        audit_binary(source / "ffmpeg", (14, 0, 0))
        result = subprocess.run([str(source / "ffmpeg"), "-L"], capture_output=True, text=True, check=True)
        if "Lesser General Public License" not in result.stdout:
            raise RuntimeError("FFmpeg license audit failed")
        DEST.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / "ffmpeg", DEST / "ffmpeg")
        shutil.copy2(archive, DEST / archive.name)
        shutil.copy2(source / "COPYING.LGPLv2.1", DEST / "FFmpeg-LGPL-2.1.txt")
        (DEST / "FFmpeg-BUILD.txt").write_text(result.stderr + result.stdout + "\n" + json.dumps(FLAGS, indent=2))
        files = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in DEST.iterdir() if p.is_file() and p.name != "manifest.json"}
        manifest.write_text(json.dumps(dict(source=SOURCE_URL, source_sha256=SOURCE_SHA256, flags=FLAGS, files=files), indent=2))
    return DEST


if __name__ == "__main__":
    prepare()
