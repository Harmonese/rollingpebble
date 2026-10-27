"""Audit native architecture and reject absolute non-system build dependencies."""

from __future__ import annotations

import argparse
from pathlib import Path
import struct
import subprocess
import sys
import tempfile


def audit_binary(path: Path, minimum=(14, 0, 0)) -> None:
    if sys.platform == "win32":
        import pefile

        try:
            pe = pefile.PE(str(path), fast_load=True)
            if pe.FILE_HEADER.Machine != 0x8664:
                raise RuntimeError(f"Expected Windows x86_64 PE: {path}")
            pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"]])
            for entry in getattr(pe, "DIRECTORY_ENTRY_IMPORT", []):
                if any(char in entry.dll for char in (b"/", b"\\", b":")):
                    raise RuntimeError(f"Absolute DLL dependency in {path}: {entry.dll!r}")
            pe.close()
        except pefile.PEFormatError as exc:
            raise RuntimeError(f"Expected Windows x86_64 PE: {path}") from exc
        return
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
            if sys.platform == "win32" and binary.read_bytes()[:2] != b"MZ":
                continue
            audit_binary(binary)
            count += 1
    for path in sorted({p.resolve() for p in runtime.rglob("*") if p.is_file()}):
        with path.open("rb") as stream:
            magic = stream.read(4)
            if not (magic[:2] == b"MZ" if sys.platform == "win32" else magic == b"\x7fELF"):
                continue
        audit_binary(path)
        count += 1
    print(f"Audited {count} {'Windows x86_64 PE' if sys.platform == 'win32' else 'Linux x86_64 ELF'} binaries")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("sidecar", type=Path)
    parser.add_argument("runtime", type=Path)
    args = parser.parse_args()
    audit(args.sidecar, args.runtime)
