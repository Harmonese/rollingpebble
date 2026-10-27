"""Extract pinned source archives without requiring Windows symlink privileges."""
from pathlib import Path
import sys
import tarfile


def extract_source(archive: tarfile.TarFile, destination: Path) -> None:
    if sys.platform != "win32":
        archive.extractall(destination, filter="data")
        return
    members = archive.getmembers()
    archive.extractall(destination, members=[m for m in members if not (m.issym() or m.islnk())], filter="data")
    for member in members:
        if not (member.issym() or member.islnk()):
            continue
        tarfile.data_filter(member, str(destination))
        target = destination / member.name
        if not target.resolve().is_relative_to(destination.resolve()):
            raise ValueError(f"Archive link escapes source directory: {member.name}")
        with archive.extractfile(member) as contents:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(contents.read())
