"""Build-only dependency resolution. Installation consumes hashed binary wheels offline."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

from prepare_python_runtime import TARGET
from email.parser import BytesParser

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get("ROLLINGPEBBLE_ENGINE_SOURCE", ROOT / "build" / "py-roller-source"))
COMMIT = "6d3ded2537c7a6d6b444c18571581d6919dea409"
DEST = ROOT / "desktop" / "engine"


def add_notices(root):
    from prepare_ffmpeg import prepare as prepare_ffmpeg
    source_root = prepare_ffmpeg()
    target = root / "bin"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source_root, target)
    from prepare_espeak import prepare as prepare_espeak
    espeak = root / "espeak"
    if espeak.exists():
        shutil.rmtree(espeak)
    shutil.copytree(prepare_espeak(), espeak)
    for source in (ROOT / "desktop" / "licenses").iterdir():
        shutil.copy2(source, target / source.name)


def prepare(python, *, update_lock=False):
    if not SOURCE.exists():
        subprocess.run(["git", "clone", "https://github.com/Harmonese/py-roller.git", str(SOURCE)], check=True)
    subprocess.run(["git", "-C", str(SOURCE), "cat-file", "-e", COMMIT + "^{commit}"], check=True)
    if (DEST / "manifest.json").exists():
        manifest = json.loads((DEST / "manifest.json").read_text())
        if not update_lock and manifest.get("recipe") == 6 and manifest.get("source") == COMMIT and manifest.get("platform") == TARGET["key"] and all(
            (DEST / file).is_file() and hashlib.sha256((DEST / file).read_bytes()).hexdigest() == digest
            for file, digest in manifest["files"].items()
        ):
            if manifest["recipe"] == 4:
                for wheel in (DEST / "wheels").glob("imageio_ffmpeg-*.whl"):
                    wheel.unlink()
                for name in ("requirements.txt", "vocals.txt"):
                    path = DEST / name
                    path.write_text("\n".join(line for line in path.read_text().splitlines()
                                              if not line.startswith("imageio-ffmpeg==")) + "\n")
            add_notices(DEST)
            manifest["recipe"] = 6
            manifest["files"] = {p.relative_to(DEST).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                                 for p in DEST.rglob("*") if p.is_file() and p != DEST / "manifest.json"}
            (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2))
            return
    with tempfile.TemporaryDirectory(prefix="rollingpebble-engine-") as temp:
        stage = Path(temp)
        wheel_cache = ROOT / "build" / f"engine-wheels-{TARGET['key']}"
        wheels = wheel_cache
        wheels.mkdir(parents=True, exist_ok=True)
        previous = json.loads((DEST / "manifest.json").read_text()) if (DEST / "manifest.json").exists() else {}
        if previous.get("platform") == TARGET["key"]:
            for cached in (DEST / "wheels").glob("*.whl"):
                if not cached.name.startswith("py_roller-"):
                    shutil.copy2(cached, wheels / cached.name)
        # Build from the exact committed source, never an editable installation.
        archive = subprocess.check_output(["git", "-C", str(SOURCE), "archive", COMMIT])
        import io
        import tarfile
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(stage / "source", filter="data")
        env = {**os.environ, "SOURCE_DATE_EPOCH": "1791504000"}
        if TARGET["system"] == "darwin":
            env["MACOSX_DEPLOYMENT_TARGET"] = "14.0"
        elif TARGET["system"] == "linux":
            env.setdefault("CC", "gcc")
            env.setdefault("CXX", "g++")
        subprocess.run([str(python), "-m", "pip", "wheel", "--no-deps", "--wheel-dir", str(wheels),
                        str(stage / "source")], env=env, check=True)
        engine = next(wheels.glob("py_roller-*.whl"))
        subprocess.run([str(python), "-m", "pip", "wheel", "--no-deps", "--wheel-dir", str(wheels),
                        "demucs==4.1.0", "dora-search==0.1.12", "julius==0.2.7", "treetable==0.2.5", "antlr4-python3-runtime==4.9.3", "langid==1.1.6"], env=env, check=True)
        lock = ROOT / "desktop" / f"engine-{TARGET['key']}.lock"
        locked = stage / "locked.txt"
        if lock.exists() and not update_lock:
            locked.write_text(lock.read_text())
            subprocess.run([str(python), "-m", "pip", "download", "--only-binary=:all:", "--require-hashes",
                            "--find-links", str(wheels), *(["--extra-index-url", TARGET["extra_index"]] if TARGET["extra_index"] else []), "-d", str(wheels), "-r", str(locked)], check=True)
        else:
            seed = lock if lock.exists() else ROOT / "desktop" / "engine-macos-arm64.lock"
            constraints = stage / "constraints.txt"
            constraints.write_text("\n".join(line.split()[0] for line in seed.read_text().splitlines() if not line.lower().startswith(("torch==", "torchaudio=="))))
            # These upstream packages ship Python source only. Build their wheels here,
            # never at install time. All native neural dependencies must be binary wheels.
            subprocess.run([str(python), "-m", "pip", "download", "--only-binary=:all:", "--find-links", str(wheels), "-d", str(wheels), *(["--extra-index-url", TARGET["extra_index"]] if TARGET["extra_index"] else []), "--constraint", str(constraints),
                            str(engine) + "[vocals,mul]", "demucs==4.1.0", "dora-search==0.1.12", "julius==0.2.7", "treetable==0.2.5", "antlr4-python3-runtime==4.9.3",
                            f"torch=={TARGET['torch']}", f"torchaudio=={TARGET['torch']}", "numpy==2.2.6", "PySocks==1.7.1",
                            "av==16.1.0"], check=True)
        shutil.copytree(wheels, stage / "wheels")
        wheels = stage / "wheels"
        requirements = []
        names = {}
        for wheel in sorted(wheels.glob("*.whl")):
            with zipfile.ZipFile(wheel) as package:
                meta = BytesParser().parsebytes(package.read(next(n for n in package.namelist() if n.endswith('.dist-info/METADATA'))))
                requirements.append(f'{meta["Name"]}=={meta["Version"]} --hash=sha256:{hashlib.sha256(wheel.read_bytes()).hexdigest()}')
                names[meta["Name"].lower().replace("_", "-")] = requirements[-1]
                from audit_native import audit_binary
                for member in package.namelist():
                    if member.endswith((".so", ".dylib", ".pyd", ".dll")):
                        binary = stage / "audit-binary"
                        binary.write_bytes(package.read(member))
                        audit_binary(binary, (14, 0, 0))
                        binary.unlink()
        # Resolve the base dependency closure using the prepared wheels; vocals stays optional.
        resolved = stage / "core.json"
        subprocess.run([str(python), "-m", "pip", "install", "--dry-run", "--ignore-installed", "--no-index",
                        "--find-links", str(wheels), "--report", str(resolved), "py-roller[mul]==0.10.3"], check=True)
        core_names = {item["metadata"]["name"].lower().replace("_", "-") for item in json.loads(resolved.read_text())["install"]}
        core = [value for name, value in names.items() if name in core_names or name == "pysocks"]
        (stage / "requirements.txt").write_text("\n".join(core) + "\n")
        (stage / "vocals.txt").write_text("\n".join(requirements) + "\n")
        resolved.unlink()
        locked.unlink(missing_ok=True)
        (stage / "constraints.txt").unlink(missing_ok=True)
        # Locally built wheel bytes can vary by compiler. Its source commit is pinned;
        # every installation still verifies its exact build-specific manifest hash.
        third_party = "\n".join(line for line in requirements if not line.startswith("py-roller==")) + "\n"
        from audit_native import audit_binary
        # Preserve resolved downloads if a later native build needs repair/retry.
        add_notices(stage)
        audit_binary(stage / "bin" / ("ffmpeg.exe" if TARGET["system"] == "win32" else "ffmpeg"), (14, 0, 0))
        shutil.rmtree(stage / "source")
        files = {p.relative_to(stage).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in stage.rglob('*') if p.is_file()}
        (stage / "manifest.json").write_text(json.dumps({"source": COMMIT, "platform": TARGET["key"], "recipe": 6, "files": files}, indent=2))
        if DEST.exists():
            shutil.rmtree(DEST)
        shutil.copytree(stage, DEST)
        if not lock.exists() or update_lock:
            lock.write_text(third_party)
