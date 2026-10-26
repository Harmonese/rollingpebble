"""Desktop recipes select host resources and reject foreign or developer binaries."""

import importlib.util
from pathlib import Path
import sys

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
    with pytest.raises(RuntimeError, match="not configured"):
        runtime.target_spec("linux", "aarch64")


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
