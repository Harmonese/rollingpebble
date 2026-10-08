from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from macholib.MachO import MachO
from macholib.mach_o import LC_BUILD_VERSION, LC_VERSION_MIN_MACOSX
from PyInstaller.archive.readers import CArchiveReader


ROOT = Path(__file__).resolve().parents[1]
ARM64 = 0x0100000C


def audit_binary(path: Path, minimum: tuple[int, int, int]) -> None:
    headers = [header for header in MachO(str(path)).headers if header.header.cputype == ARM64]
    if not headers:
        raise RuntimeError(f"Missing arm64 code: {path}")
    for header in headers:
        versions = []
        for command, details, _ in header.commands:
            if command.cmd == LC_BUILD_VERSION:
                if details.platform != 1:
                    raise RuntimeError(f"Not a macOS binary: {path}")
                versions.append(int(details.minos))
            elif command.cmd == LC_VERSION_MIN_MACOSX:
                versions.append(int(details.version))
        if not versions:
            raise RuntimeError(f"Missing deployment target: {path}")
        for value in versions:
            version = (value >> 16, (value >> 8) & 255, value & 255)
            if version > minimum:
                raise RuntimeError(f"{path}: requires macOS {version}, app declares {minimum}")
        for _, _, dependency in header.walkRelocatables():
            if dependency.startswith("/") and not dependency.startswith(("/usr/lib/", "/System/Library/")):
                raise RuntimeError(f"External library dependency in {path}: {dependency}")


def audit(sidecar: Path, runtime: Path) -> None:
    config = json.loads((ROOT / "src-tauri" / "tauri.conf.json").read_text())
    parts = tuple(int(part) for part in config["bundle"]["macOS"]["minimumSystemVersion"].split("."))
    minimum = (parts + (0, 0))[:3]
    audit_binary(sidecar, minimum)
    archive = CArchiveReader(str(sidecar))
    count = 1
    with tempfile.TemporaryDirectory(prefix="rollingpebble-binary-audit-") as temporary:
        for name, entry in archive.toc.items():
            if entry[-1] != "b":
                continue
            binary = Path(temporary) / "binary"
            binary.write_bytes(archive.extract(name))
            try:
                audit_binary(binary, minimum)
            except RuntimeError as error:
                raise RuntimeError(f"Sidecar member {name}: {error}") from error
            count += 1
    paths = {path.resolve() for path in runtime.rglob("*") if path.suffix in {".so", ".dylib"}}
    paths.add((runtime / "bin" / "python3.12").resolve())
    for path in sorted(paths):
        audit_binary(path, minimum)
        count += 1
    print(f"Audited {count} arm64 binaries: deployment targets and external library paths OK")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("sidecar", type=Path)
    parser.add_argument("runtime", type=Path)
    args = parser.parse_args()
    audit(args.sidecar, args.runtime)
