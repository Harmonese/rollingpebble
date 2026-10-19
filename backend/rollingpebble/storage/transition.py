"""One-time data layout transaction. Source cleanup follows runtime validation."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path

from rollingpebble.auto_timing.store import atomic_json


def tree_digest(root: Path) -> dict[str, str]:
    result = {}
    if not root.exists():
        return result
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            # Models may use relative links, but copying outside the tree is forbidden.
            if not path.resolve().is_relative_to(root.resolve()):
                raise ValueError(f"External symbolic link: {path}")
        if path.is_file():
            with path.open("rb") as stream:
                result[str(path.relative_to(root))] = hashlib.file_digest(stream, "sha256").hexdigest()
    return result


def transfer(source: Path, target: Path):
    if source.resolve() == target.resolve() or not source.exists():
        return
    expected = tree_digest(source)
    if target.exists() and any(target.iterdir()):
        if tree_digest(target) != expected:
            raise ValueError(f"Storage destination contains different data: {target}")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    stage = target.with_name(f".{target.name}.moving")
    if stage.exists():
        shutil.rmtree(stage)
    shutil.copytree(source, stage, symlinks=True)
    for link in stage.rglob("*"):
        if link.is_symlink() and Path(os.readlink(link)).is_absolute():
            destination = stage / link.resolve().relative_to(source.resolve())
            link.unlink()
            link.symlink_to(os.path.relpath(destination, link.parent))
    if tree_digest(stage) != expected:
        raise OSError("Storage verification failed")
    if target.exists():
        target.rmdir()
    stage.rename(target)


def rewrite_artifacts(results: Path, old: Path, new: Path):
    def replace(value):
        if isinstance(value, dict):
            return {key: replace(item) for key, item in value.items()}
        if isinstance(value, list):
            return [replace(item) for item in value]
        if isinstance(value, str) and value.startswith(str(old) + "/"):
            return str(new) + value[len(str(old)):]
        return value
    for file in results.glob("*/*/record.json"):
        record = json.loads(file.read_text())
        if "artifacts" in record:
            record["artifacts"] = replace(record["artifacts"])
        atomic_json(file, record)


def begin_layout_transition(root: Path):
    root.mkdir(parents=True, exist_ok=True)
    marker = root / ".layout-transition.json"
    settings_path = root / "settings.json"
    data = json.loads(settings_path.read_text()) if settings_path.exists() else {}
    if data.get("storage_layout_version") == 3 and not marker.exists():
        return
    if marker.exists():
        transaction = json.loads(marker.read_text())
    else:
        transaction = {"sources": {
            "engine": data.get("auto_timing_engine_data") or str(Path(data.get("storage_cache_root") or root / "cache") / "pyroller"),
            "projects": data.get("storage_projects_root") or str(root / "projects"),
            "results": str(Path(data.get("storage_work_root") or root / "work") / "auto-timing"),
        }}
        atomic_json(marker, transaction)
    for name, raw in transaction["sources"].items():
        if name in transaction.get("transferred", []):
            continue
        source, target = Path(raw).expanduser(), root / name
        if name == "results" and source.exists():
            from rollingpebble.auto_timing.store import RunStore
            RunStore(source)
        transfer(source, target)
        transaction.setdefault("transferred", []).append(name)
        atomic_json(marker, transaction)
    rewrite_artifacts(root / "results", Path(transaction["sources"]["results"]), root / "results")
    # Only current preference fields survive. Old locations live in the transaction until commit.
    from rollingpebble.models import RuntimeSettingsModel
    data["auto_roller_profile"] = "auto"
    data.setdefault("auto_timing_v2_options", {}).setdefault(
        "alignment_mode", "unordered" if settings_path.exists() else "ordered")
    current = RuntimeSettingsModel.model_validate(data)
    current.storage_layout_version = 3
    atomic_json(settings_path, current.model_dump())


def finish_layout_transition(root: Path):
    marker = root / ".layout-transition.json"
    if not marker.exists():
        return
    transaction = json.loads(marker.read_text())
    # Only application-owned paths inside this root are deleted automatically.
    candidates = [root / name for name in ("envs", "toolchains", "models", "cache/pip", "cache/pyroller", "work/jobs")]
    for name, raw in transaction["sources"].items():
        source = Path(raw).expanduser()
        if source.resolve() != (root / name).resolve() and source.resolve().is_relative_to(root.resolve()):
            candidates.append(source)
    for path in candidates:
        if path.is_symlink():
            raise ValueError(f"Refusing to remove symbolic link: {path}")
        if path.is_dir():
            shutil.rmtree(path)
    for path in (root / "settings.pre-protocol-v2.json", root / ".DS_Store"):
        path.unlink(missing_ok=True)
    work = root / "work"
    if work.exists():
        for path in sorted(work.rglob("*"), reverse=True):
            if path.is_dir() and not any(path.iterdir()):
                path.rmdir()
        if not any(work.iterdir()):
            work.rmdir()
    marker.unlink()
