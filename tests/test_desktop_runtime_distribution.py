"""Release-only pruning; never modify developer or installed user runtimes."""
import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("runtime_distribution", Path(__file__).parents[1] / "desktop" / "prepare_python_runtime.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def runtime_fixture(root):
    (root / "bin").mkdir(parents=True)
    (root / "bin" / "python3.12").write_bytes(b"python executable")
    try:
        (root / "bin" / "python").symlink_to("python3.12")
    except OSError:  # Windows accounts without the symlink privilege.
        (root / "bin" / "python").write_bytes(b"python executable")
    (root / "bin" / "python3").write_bytes(b"python executable")
    lib = root / "lib"
    (lib / "__pycache__").mkdir(parents=True)
    (lib / "module.py").write_text("source")
    (lib / "__pycache__" / "module.cpython-312.pyc").write_bytes(b"cache")
    (lib / "__pycache__" / "module.cpython-312.opt-1.pyc").write_bytes(b"cache")
    (lib / "__pycache__" / "sourceless.cpython-312.pyc").write_bytes(b"keep")
    (lib / "legacy.py").write_text("source")
    (lib / "legacy.pyc").write_bytes(b"cache")
    for name in ("venv", "ensurepip", "pip", "tkinter", "ssl", "LICENSE"):
        (lib / name).write_bytes(b"keep")


def test_prune_aliases_and_only_redundant_bytecode(tmp_path, monkeypatch):
    source, target = tmp_path / "full", tmp_path / "dist"
    runtime_fixture(source)
    monkeypatch.setattr(module, "runtime_executable", lambda root: root / "bin/python3.12")
    monkeypatch.setattr(module, "_is_ready", lambda root: True)
    module.prepare_distribution(source, target)
    assert (target / "bin" / "python3.12").is_file()
    assert not (target / "bin" / "python").exists()
    assert not (target / "bin" / "python3").exists()
    assert not (target / "lib" / "legacy.pyc").exists()
    assert not (target / "lib" / "__pycache__" / "module.cpython-312.pyc").exists()
    assert not (target / "lib" / "__pycache__" / "module.cpython-312.opt-1.pyc").exists()
    assert (target / "lib" / "__pycache__" / "sourceless.cpython-312.pyc").read_bytes() == b"keep"
    assert (source / "bin" / "python").read_bytes() == b"python executable"
    assert (source / "lib" / "legacy.pyc").exists()
    for name in ("venv", "ensurepip", "pip", "tkinter", "ssl", "LICENSE"):
        assert (target / "lib" / name).read_bytes() == b"keep"
    module.prepare_distribution(source, target)
    assert not (target / "bin" / "python").exists()


def test_unexpected_alias_and_failed_validation_preserve_existing_distribution(tmp_path, monkeypatch):
    source, target = tmp_path / "full", tmp_path / "dist"
    runtime_fixture(source)
    monkeypatch.setattr(module, "runtime_executable", lambda root: root / "bin/python3.12")
    target.mkdir()
    (target / "sentinel").write_text("old")
    (source / "bin" / "python3").write_text("different binary")
    with pytest.raises(RuntimeError, match="Unexpected Python alias"):
        module.prepare_distribution(source, target)
    (source / "bin" / "python3").write_bytes(b"python executable")
    monkeypatch.setattr(module, "_is_ready", lambda root: False)
    with pytest.raises(RuntimeError, match="failed validation"):
        module.prepare_distribution(source, target)
    assert (target / "sentinel").read_text() == "old"
    with pytest.raises(RuntimeError, match="separate directories"):
        module.prepare_distribution(source, source)
