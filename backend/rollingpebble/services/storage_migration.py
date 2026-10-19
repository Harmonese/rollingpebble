from __future__ import annotations

import json
import shutil
from pathlib import Path

from rollingpebble.auto_timing.store import atomic_json
from rollingpebble.paths import StorageLayout
from rollingpebble.runtime.installer import install_runtime
from rollingpebble.storage.location import select_root
from rollingpebble.storage.transition import transfer, rewrite_artifacts, tree_digest


def relocate(service, target_path: str, apply):
    source = service.layout.app_root.resolve()
    target = Path(target_path).expanduser()
    if not target.is_absolute() or target.is_symlink():
        raise ValueError("Choose an absolute directory")
    target = target.resolve()
    if target.is_relative_to(source) or source.is_relative_to(target):
        raise ValueError("Storage locations overlap")
    journal = source / ".relocation.json"
    expected = {"target": str(target), "phase": "copying"}
    if journal.exists():
        existing = json.loads(journal.read_text())
        if existing["target"] != str(target):
            raise ValueError("Finish the pending storage relocation first")
        expected = existing
    elif target.exists() and any(target.iterdir()):
        raise ValueError("Target directory must be empty")
    atomic_json(journal, expected)
    target.mkdir(parents=True, exist_ok=True)
    for name in ("projects", "engine", "results", "recovery"):
        if name in expected.get("transferred", []):
            continue
        transfer(source / name, target / name)
        expected.setdefault("transferred", []).append(name)
        expected.setdefault("digests", {})[name] = tree_digest(source / name)
        atomic_json(journal, expected)
    for name in ("settings.json", "workspace-bg"):
        if (source / name).exists():
            shutil.copy2(source / name, target / name)
    rewrite_artifacts(target / "results", source, target)
    install_runtime(target, vocals="vocals" in service.runtime_manager._read_runtime_metadata("auto").get("prepared_capabilities", []),
                    ensure=True)
    for name, digest in expected["digests"].items():
        if tree_digest(source / name) != digest:
            raise ValueError("Source data changed during relocation")
    atomic_json(journal, {**expected, "phase": "verified"})
    # Selection is durable before services switch; a later cleanup failure can be resumed.
    atomic_json(target / ".relocation-cleanup.json", {"source": str(source)})
    select_root(target)
    service.update_layout(StorageLayout.from_data_dir(target).ensure())
    apply()
    finish_relocation(target)
    return service.usage()


def finish_relocation(target):
    marker = target / ".relocation-cleanup.json"
    if not marker.exists():
        return
    source = Path(json.loads(marker.read_text())["source"])
    journal = source / ".relocation.json"
    if source.exists():
        if not journal.exists() or json.loads(journal.read_text()).get("target") != str(target):
            raise ValueError("Relocation cleanup identity mismatch")
        # Unknown files are preserved rather than swept into a recursive root removal.
        saved = json.loads(journal.read_text())
        for name in ("projects", "engine", "results", "recovery"):
            remaining = tree_digest(source / name)
            if any(saved["digests"].get(name, {}).get(path) != digest for path, digest in remaining.items()):
                raise ValueError("Source data changed during relocation")
        for name in ("projects", "engine", "results", "recovery", "runtime", "cache"):
            path = source / name
            if path.is_symlink():
                raise ValueError("Refusing symbolic link cleanup")
            if path.exists():
                shutil.rmtree(path)
        for name in ("settings.json", "workspace-bg", ".DS_Store", ".relocation.json"):
            (source / name).unlink(missing_ok=True)
        if not any(source.iterdir()):
            source.rmdir()
    marker.unlink()


