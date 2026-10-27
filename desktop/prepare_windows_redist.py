"""Pinned, app-local release runtime DLLs for native C++ engine wheels."""
import hashlib
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NAME = "Microsoft.VC.14.44.17.14.CRT.Redist.X64.base.vsix"
SHA256 = "4aaf54db0bfc9435f7c3660e1a00237a4b556042bfeea64bde44c2e0194e6ee5"
URL = f"https://download.visualstudio.microsoft.com/download/pr/45d3b8dd-bced-4b37-9974-142f748d710c/{SHA256}/{NAME}"


def prepare(destination: Path) -> None:
    archive = ROOT / "build" / "downloads" / NAME
    archive.parent.mkdir(parents=True, exist_ok=True)
    cached = ROOT / "build" / "tools" / "downloads" / NAME
    if not archive.exists() and cached.exists():
        archive.write_bytes(cached.read_bytes())
    if not archive.exists():
        urllib.request.urlretrieve(URL, archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
        raise RuntimeError("Microsoft C++ runtime checksum mismatch")
    with zipfile.ZipFile(archive) as package:
        for member in package.namelist():
            if "/x64/Microsoft.VC143." not in member or "/debug_nonredist/" in member:
                continue
            if not member.endswith(".dll") or not any(f"Microsoft.VC143.{part}/" in member for part in ("CRT", "OpenMP")):
                continue
            target = destination / Path(member).name
            # Preserve the CRT already supplied by pinned standalone CPython.
            if not target.exists():
                target.write_bytes(package.read(member))
    (destination / "Microsoft-VC-Runtime-NOTICE.txt").write_text(
        "Microsoft Visual C++ 2015-2022 Runtime, x64 (14.44.35112).\n"
        "Copyright Microsoft Corporation. All rights reserved.\n"
        "App-local release DLLs; no debug runtime is redistributed.\n"
        "License: https://visualstudio.microsoft.com/license-terms/vs2022-cruntime/\n"
        f"Source package: {URL}\nSHA-256: {SHA256}\n", encoding="utf-8")
