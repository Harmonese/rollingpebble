"""Desktop recipes select host resources and reject foreign or developer binaries."""

import importlib.util
import io
from pathlib import Path
import sys
import tarfile

import pytest


ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "desktop" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_platform_selection_uses_distinct_interpreters_and_cpu_lock():
    runtime = load("prepare_python_runtime")
    linux = runtime.target_spec("linux", "x86_64")
    mac = runtime.target_spec("darwin", "arm64")
    assert linux["python_triple"] == "x86_64-unknown-linux-gnu"
    assert mac["python_triple"] == "aarch64-apple-darwin"
    assert linux["python_sha256"] != mac["python_sha256"]
    assert linux["torch"].endswith("+cpu")
    windows = runtime.target_spec("win32", "amd64")
    assert windows["key"] == "windows-x86_64"
    assert windows["python_triple"] == "x86_64-pc-windows-msvc"
    assert windows["torch"].endswith("+cpu")
    with pytest.raises(RuntimeError, match="not configured"):
        runtime.target_spec("linux", "aarch64")


@pytest.mark.skipif(sys.platform != "win32", reason="Windows PE audit")
def test_pe_audit_rejects_foreign_architecture(tmp_path):
    audit = load("audit_native")
    audit.audit_binary(Path(sys.executable).resolve())
    foreign = tmp_path / "foreign.exe"
    contents = bytearray(Path(sys.executable).read_bytes())
    pe_offset = int.from_bytes(contents[0x3C:0x40], "little")
    contents[pe_offset + 4:pe_offset + 6] = (0xAA64).to_bytes(2, "little")
    foreign.write_bytes(contents)
    with pytest.raises(RuntimeError, match="x86_64 PE"):
        audit.audit_binary(foreign)


def test_windows_source_extraction_materializes_internal_links(tmp_path, monkeypatch):
    extract = load("extract_source")
    monkeypatch.setattr(extract.sys, "platform", "win32")
    contents = io.BytesIO()
    with tarfile.open(fileobj=contents, mode="w") as archive:
        member = tarfile.TarInfo("source/include/header.h")
        member.size = 6
        archive.addfile(member, io.BytesIO(b"header"))
        link = tarfile.TarInfo("source/compat/header.h")
        link.type = tarfile.SYMTYPE
        link.linkname = "../include/header.h"
        archive.addfile(link)
    contents.seek(0)
    with tarfile.open(fileobj=contents) as archive:
        extract.extract_source(archive, tmp_path)
    copied = tmp_path / "source/compat/header.h"
    assert not copied.is_symlink()
    assert copied.read_bytes() == b"header"


@pytest.mark.skipif(sys.platform != "linux", reason="Linux ELF audit")
def test_elf_audit_accepts_host_python_and_rejects_foreign_architecture(tmp_path):
    audit = load("audit_native")
    audit.audit_binary(Path(sys.executable).resolve())
    foreign = tmp_path / "foreign.so"
    header = bytearray(20)
    header[:6] = b"\x7fELF\x02\x01"
    header[18:20] = (183).to_bytes(2, "little")  # ELF AArch64
    foreign.write_bytes(header)
    with pytest.raises(RuntimeError, match="x86_64 ELF"):
        audit.audit_binary(foreign)
