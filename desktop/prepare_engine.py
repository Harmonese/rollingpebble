"""Build-only dependency resolution. Installation consumes hashed binary wheels offline."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile
from email.parser import BytesParser

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "py-roller"
COMMIT = "6d3ded2"
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
    if (DEST / "manifest.json").exists():
        manifest = json.loads((DEST / "manifest.json").read_text())
        if not update_lock and manifest.get("recipe") == 6 and manifest.get("source") == COMMIT and all(
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
            manifest["files"] = {str(p.relative_to(DEST)): hashlib.sha256(p.read_bytes()).hexdigest()
                                 for p in DEST.rglob("*") if p.is_file() and p != DEST / "manifest.json"}
            (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2))
            return
    with tempfile.TemporaryDirectory(prefix="rollingpebble-engine-") as temp:
        stage = Path(temp)
        wheels = stage / "wheels"
        wheels.mkdir()
        for cached in (DEST / "wheels").glob("*.whl"):
            if not cached.name.startswith("py_roller-"):
                shutil.copy2(cached, wheels / cached.name)
        # Build from the exact committed source, never an editable installation.
        archive = subprocess.check_output(["git", "-C", str(SOURCE), "archive", COMMIT])
        import io
        import tarfile
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(stage / "source", filter="data")
        env = {**os.environ, "MACOSX_DEPLOYMENT_TARGET": "14.0", "SOURCE_DATE_EPOCH": "1791504000"}
        subprocess.run([str(python), "-m", "pip", "wheel", "--no-deps", "--wheel-dir", str(wheels),
                        str(stage / "source")], env=env, check=True)
        engine = next(wheels.glob("py_roller-*.whl"))
        subprocess.run([str(python), "-m", "pip", "wheel", "--no-deps", "--wheel-dir", str(wheels),
                        "demucs==4.1.0", "dora-search==0.1.12", "julius==0.2.7", "treetable==0.2.5", "antlr4-python3-runtime==4.9.3", "langid==1.1.6"], env=env, check=True)
        lock = ROOT / "desktop" / "engine-macos-arm64.lock"
        locked = stage / "locked.txt"
        if lock.exists() and not update_lock:
            locked.write_text(lock.read_text())
            subprocess.run([str(python), "-m", "pip", "download", "--only-binary=:all:", "--require-hashes",
                            "--find-links", str(wheels), "-d", str(wheels), "-r", str(locked)], check=True)
        else:
            constraints = stage / "constraints.txt"
            constraints.write_text("\n".join(line.split()[0] for line in lock.read_text().splitlines()) if lock.exists() else "")
            # These upstream packages ship Python source only. Build their wheels here,
            # never at install time. All native neural dependencies must be binary wheels.
            subprocess.run([str(python), "-m", "pip", "download", "--only-binary=:all:", "--find-links", str(wheels), "-d", str(wheels), "--constraint", str(constraints),
                            str(engine) + "[vocals,mul]", "demucs==4.1.0", "dora-search==0.1.12", "julius==0.2.7", "treetable==0.2.5", "antlr4-python3-runtime==4.9.3",
                            "torch==2.8.0", "torchaudio==2.8.0", "numpy==2.2.6", "PySocks==1.7.1",
                            "av==16.1.0"], check=True)
        requirements = []
        names = {}
        for wheel in sorted(wheels.glob("*.whl")):
            with zipfile.ZipFile(wheel) as package:
                meta = BytesParser().parsebytes(package.read(next(n for n in package.namelist() if n.endswith('.dist-info/METADATA'))))
                requirements.append(f'{meta["Name"]}=={meta["Version"]} --hash=sha256:{hashlib.sha256(wheel.read_bytes()).hexdigest()}')
                names[meta["Name"].lower().replace("_", "-")] = requirements[-1]
                from audit_macos import audit_binary
                for member in package.namelist():
                    if member.endswith((".so", ".dylib")):
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
        if not lock.exists() or update_lock:
            lock.write_text(third_party)
        from audit_macos import audit_binary
        add_notices(stage)
        audit_binary(stage / "bin" / "ffmpeg", (14, 0, 0))
        shutil.rmtree(stage / "source")
        files = {str(p.relative_to(stage)): hashlib.sha256(p.read_bytes()).hexdigest() for p in stage.rglob('*') if p.is_file()}
        (stage / "manifest.json").write_text(json.dumps({"source": COMMIT, "recipe": 6, "files": files}, indent=2))
        if DEST.exists():
            shutil.rmtree(DEST)
        shutil.copytree(stage, DEST)
