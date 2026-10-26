"""Audit native architecture and reject absolute non-system build dependencies."""

from __future__ import annotations

import argparse
from pathlib import Path
import struct
import subprocess
import sys
import tempfile


def audit_binary(path: Path, minimum=(14, 0, 0)) -> None:
    if sys.platform == "darwin":
        from audit_macos import audit_binary as audit_macos

        audit_macos(path, minimum)
        return
    with path.open("rb") as stream:
        header = stream.read(20)
    if header[:6] != b"\x7fELF\x02\x01" or struct.unpack("<H", header[18:20])[0] != 62:
        raise RuntimeError(f"Expected Linux x86_64 ELF: {path}")
    dynamic = subprocess.check_output(["readelf", "-d", str(path)], text=True)
    for line in dynamic.splitlines():
        if "(NEEDED)" in line and "[/" in line:
            raise RuntimeError(f"Absolute shared-library dependency in {path}: {line}")
        if any(
            str(prefix) in line for prefix in (Path.home(), Path(__file__).resolve().parents[1])
        ):
            raise RuntimeError(f"Developer library path in {path}: {line}")


def audit(sidecar: Path, runtime: Path) -> None:
    if sys.platform == "darwin":
        from audit_macos import audit as audit_macos

        audit_macos(sidecar, runtime)
        return
    from PyInstaller.archive.readers import CArchiveReader

    audit_binary(sidecar)
    archive = CArchiveReader(str(sidecar))
    count = 1
    with tempfile.TemporaryDirectory(prefix="rollingpebble-elf-audit-") as temporary:
        for name, entry in archive.toc.items():
            if entry[-1] != "b":
                continue
            binary = Path(temporary) / "binary"
            binary.write_bytes(archive.extract(name))
            audit_binary(binary)
            count += 1
    for path in sorted({p.resolve() for p in runtime.rglob("*") if p.is_file()}):
        with path.open("rb") as stream:
            if stream.read(4) != b"\x7fELF":
                continue
        audit_binary(path)
        count += 1
    print(f"Audited {count} Linux x86_64 ELF binaries")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("sidecar", type=Path)
    parser.add_argument("runtime", type=Path)
    args = parser.parse_args()
    audit(args.sidecar, args.runtime)
