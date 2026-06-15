from __future__ import annotations

import json
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from rollingpebble.models import (
    ProjectModel,
    StorageCategoryModel,
    StorageModelItemModel,
    StorageOtherItemModel,
    StorageProjectModel,
    StorageRootModel,
    StorageRuntimeItemModel,
    StorageUsageResponse,
)
from rollingpebble.paths import StorageLayout
from rollingpebble.services.storage_shared import (
    CATEGORY_DESCRIPTIONS,
    CATEGORY_LABELS,
    GENERATED_DIRS,
    IGNORED_MODEL_NAMES,
    IGNORED_OTHER_NAMES,
    IGNORED_SYSTEM_NAMES,
    LYRICS_OUTPUT_FILES,
)
from rollingpebble.storage.files import read_project


class StorageUsageMixin:
    def model_item_path(self, model_id: str) -> Path:
        item = next((item for item in self._model_items() if item.id == model_id), None)
        if item is None:
            raise FileNotFoundError(f"Model cache item not found: {model_id}")
        return self._absolute_from_relative(item.relative_path)


    def runtime_item_path(self, runtime_id: str) -> Path:
        item = next((item for item in self._runtime_items() if item.runtime_id == runtime_id), None)
        if item is None:
            raise FileNotFoundError(f"Runtime not found: {runtime_id}")
        return self._absolute_from_relative(item.relative_path)


    def other_item_open_path(self, relative_path: str) -> Path:
        item = self._other_item_for_path(relative_path)
        path = self._absolute_from_relative(item.relative_path)
        if path.is_file() or path.is_symlink():
            return path.parent
        return path


    def usage(self) -> StorageUsageResponse:
        self._apply_project_auto_delete_policy()
        projects = self._project_summaries()
        model_items = self._model_items()
        runtime_items = self._runtime_items()
        other_items = self._other_items()
        total_bytes, total_count = self._storage_total_stats()
        categories = [
            self._category_from_stats("projects", sum(item.total_bytes for item in projects), sum(item.file_count for item in projects), self.projects_root),
            self._category("models", [self.layout.models_root]),
            self._category("runtime_envs", [self.layout.runtime_root]),
            self._category_from_stats("other", sum(item.bytes for item in other_items), sum(item.file_count for item in other_items), self.data_dir),
        ]
        return StorageUsageResponse(
            data_dir=str(self.data_dir),
            roots=self._storage_roots(projects, model_items, runtime_items, other_items),
            total_bytes=total_bytes,
            file_count=total_count,
            categories=categories,
            projects=projects,
            models=model_items,
            runtimes=runtime_items,
            other_items=other_items,
        )


    def _storage_total_stats(self) -> tuple[int, int]:
        roots = [
            self.layout.app_root,
            self.layout.projects_root,
            self.layout.models_root,
            self.layout.cache_root,
            self.layout.runtime_root,
            self.layout.work_root,
        ]
        selected: list[Path] = []
        for root in sorted({path.expanduser().resolve(strict=False) for path in roots}, key=lambda path: len(path.parts)):
            if any(self._is_relative_to(root, existing) for existing in selected):
                continue
            selected.append(root)
        return self._sum_stats(selected)


    def _category(self, category_id: str, paths: Iterable[Path]) -> StorageCategoryModel:
        total_bytes = 0
        total_count = 0
        first_path = ""
        for path in paths:
            if not first_path:
                first_path = str(path)
            size, count = self._tree_stats(path)
            total_bytes += size
            total_count += count
        return self._category_from_stats(category_id, total_bytes, total_count, Path(first_path) if first_path else self.data_dir)


    def _category_from_stats(self, category_id: str, bytes_: int, file_count: int, path: Path) -> StorageCategoryModel:
        return StorageCategoryModel(
            id=category_id,
            label=CATEGORY_LABELS[category_id],
            bytes=bytes_,
            file_count=file_count,
            path=str(path),
            description=CATEGORY_DESCRIPTIONS[category_id],
        )


    def _tree_stats(self, path: Path) -> tuple[int, int]:
        try:
            if self._is_ignored_system_child(path):
                return 0, 0
            if not path.exists() and not path.is_symlink():
                return 0, 0
            if path.is_symlink():
                stat = path.lstat()
                return int(stat.st_size), 1
            if path.is_file():
                return int(path.stat().st_size), 1
            total = 0
            count = 0
            for child in path.iterdir():
                size, files = self._tree_stats(child)
                total += size
                count += files
            return total, count
        except OSError:
            return 0, 0


    def _is_ignored_system_child(self, path: Path) -> bool:
        name = path.name
        return name in IGNORED_SYSTEM_NAMES or name.startswith("._")


    def _relative(self, path: Path) -> str:
        managed_roots = [
            ("projects", self.layout.projects_root),
            ("models", self.layout.models_root),
            ("envs", self.layout.runtime_root),
            ("cache", self.layout.cache_root),
            ("work", self.layout.work_root),
        ]
        resolved = path.resolve(strict=False)
        for prefix, root in managed_roots:
            try:
                return str(Path(prefix) / resolved.relative_to(root.resolve(strict=False))).replace("\\", "/")
            except ValueError:
                continue
        try:
            return path.relative_to(self.data_dir).as_posix()
        except ValueError:
            return path.as_posix()


    def _project_dirs(self) -> list[Path]:
        if not self.projects_root.exists():
            return []
        return sorted(path for path in self.projects_root.iterdir() if path.is_dir() and not path.is_symlink())


    def _project_summaries(self) -> list[StorageProjectModel]:
        projects: list[StorageProjectModel] = []
        for project_dir in self._project_dirs():
            project_id = project_dir.name
            project = self._read_project_metadata(project_id)
            audio_paths = self._project_audio_paths(project_dir)
            lyrics_output_paths = [project_dir / name for name in LYRICS_OUTPUT_FILES if (project_dir / name).exists()]
            generated_paths = [project_dir / name for name in GENERATED_DIRS if (project_dir / name).exists()]
            intermediate_paths = [project_dir / "intermediate"] if (project_dir / "intermediate").exists() else []
            audio_bytes, audio_count = self._sum_stats(audio_paths)
            lyrics_bytes, lyrics_count = self._sum_stats(lyrics_output_paths)
            generated_bytes, generated_count = self._sum_stats(generated_paths)
            intermediate_bytes, intermediate_count = self._sum_stats(intermediate_paths)
            total_bytes, total_count = self._tree_stats(project_dir)
            projects.append(
                StorageProjectModel(
                    project_id=project_id,
                    title=(project.metadata.track if project else "") or (project.audio_name if project else "") or project_id,
                    artist=(project.metadata.artist if project else "") or "",
                    album=(project.metadata.album if project else "") or "",
                    audio_name=(project.audio_name if project else None),
                    updated_at=(project.last_opened_at if project else None) or self._mtime_iso(project_dir),
                    audio_bytes=audio_bytes,
                    lyrics_output_bytes=lyrics_bytes,
                    generated_bytes=generated_bytes,
                    intermediate_bytes=intermediate_bytes,
                    total_bytes=total_bytes,
                    file_count=total_count,
                    audio_file_count=audio_count,
                    lyrics_output_file_count=lyrics_count,
                    generated_file_count=generated_count,
                    intermediate_file_count=intermediate_count,
                    has_audio=audio_count > 0,
                    has_lyrics_output=lyrics_count > 0,
                    has_generated=generated_count > 0,
                    has_intermediate=intermediate_count > 0,
                    active=project_id in self._active_project_ids(),
                )
            )
        projects.sort(key=lambda item: item.updated_at or "", reverse=True)
        return projects


    def _read_project_metadata(self, project_id: str) -> ProjectModel | None:
        try:
            return read_project(self.projects_root, project_id)
        except Exception:
            return None


    def _mtime_iso(self, path: Path) -> str | None:
        try:
            return time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(path.stat().st_mtime))
        except OSError:
            return None


    def _apply_project_auto_delete_policy(self) -> None:
        try:
            days = int(self.settings_store.read().project_auto_delete_days or 0)
        except Exception:
            return
        if days <= 0:
            return
        for project in self._project_summaries():
            if project.active or not self._project_is_older_than(project, days):
                continue
            project_dir = self.projects_root / project.project_id
            try:
                resolved = project_dir.resolve(strict=False)
                resolved.relative_to(self.projects_root.resolve(strict=False))
                if project_dir.exists() and project_dir.is_dir() and not project_dir.is_symlink():
                    shutil.rmtree(project_dir)
            except Exception:
                continue


    def _project_is_older_than(self, project: StorageProjectModel, days: int) -> bool:
        if project.updated_at:
            try:
                updated = datetime.fromisoformat(project.updated_at.replace("Z", "+00:00"))
                if updated.tzinfo is None:
                    updated = updated.replace(tzinfo=timezone.utc)
                return (datetime.now(timezone.utc) - updated.astimezone(timezone.utc)).total_seconds() >= days * 86400
            except ValueError:
                pass
        return self._is_older_than(self.projects_root / project.project_id, days)


    def _sum_stats(self, paths: Iterable[Path]) -> tuple[int, int]:
        total_bytes = 0
        total_count = 0
        for path in paths:
            size, count = self._tree_stats(path)
            total_bytes += size
            total_count += count
        return total_bytes, total_count


    def _storage_roots(
        self,
        projects: list[StorageProjectModel],
        models: list[StorageModelItemModel],
        runtimes: list[StorageRuntimeItemModel],
        other_items: list[StorageOtherItemModel],
    ) -> list[StorageRootModel]:
        defaults = StorageLayout.from_data_dir(self.data_dir)
        model_bytes = sum(item.bytes for item in models)
        model_count = sum(item.file_count for item in models)
        runtime_bytes = sum(item.bytes for item in runtimes)
        runtime_count = sum(item.file_count for item in runtimes)
        other_bytes = sum(item.bytes for item in other_items)
        other_count = sum(item.file_count for item in other_items)
        return [
            StorageRootModel(
                id="projects",
                label="Projects",
                path=str(self.layout.projects_root),
                default_path=str(defaults.projects_root),
                bytes=sum(item.total_bytes for item in projects),
                file_count=sum(item.file_count for item in projects),
                movable=True,
                active=any(item.active for item in projects),
            ),
            StorageRootModel(
                id="models",
                label="Models",
                path=str(self.layout.models_root),
                default_path=str(defaults.models_root),
                bytes=model_bytes,
                file_count=model_count,
                movable=True,
                active=any(item.active for item in models),
            ),
            StorageRootModel(
                id="runtime",
                label="Runtime Environments",
                path=str(self.layout.runtime_root),
                default_path=str(defaults.runtime_root),
                bytes=runtime_bytes,
                file_count=runtime_count,
                movable=False,
                active=any(item.active for item in runtimes),
            ),
            StorageRootModel(
                id="other",
                label="Other",
                path=str(self.layout.app_root),
                default_path=str(defaults.app_root),
                bytes=other_bytes,
                file_count=other_count,
                movable=False,
                active=False,
            ),
        ]


    def _model_roots(self) -> list[Path]:
        return [self.layout.models_root]


    def _manifest_records(self) -> list[dict]:
        manifest_path = self.layout.models_root / "transcriber" / "manifests" / "transcriber-index.json"
        if not manifest_path.exists():
            return []
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            return []
        models = data.get("models", {})
        if not isinstance(models, dict):
            return []
        return [item for item in models.values() if isinstance(item, dict)]


    def _record_for_model_path(self, path: Path, records: list[dict]) -> dict | None:
        resolved = path.resolve(strict=False)
        for record in records:
            for key in ("resolved_model_dir",):
                value = record.get(key)
                if not isinstance(value, str) or not value:
                    continue
                candidate = Path(value).expanduser().resolve()
                if self._paths_overlap(resolved, candidate):
                    return record
        return None


    def _paths_overlap(self, left: Path, right: Path) -> bool:
        try:
            left.relative_to(right)
            return True
        except ValueError:
            pass
        try:
            right.relative_to(left)
            return True
        except ValueError:
            return False


    def _is_ignored_model_child(self, path: Path) -> bool:
        name = path.name
        return name in IGNORED_MODEL_NAMES or name.startswith("._") or name.startswith(".")


    def _is_model_item_candidate(self, path: Path) -> bool:
        if self._is_ignored_model_child(path):
            return False
        return path.is_dir() or path.is_symlink()


    def _is_hf_model_cache_dir(self, path: Path) -> bool:
        return self._is_model_item_candidate(path) and path.name.startswith("models--")


    def _item_path_is_covered(self, path: Path, items: list[StorageModelItemModel]) -> bool:
        resolved = path.resolve(strict=False)
        for item in items:
            item_path = self._absolute_from_relative(item.relative_path).resolve(strict=False)
            if self._paths_overlap(resolved, item_path):
                return True
        return False


    def _model_id(self, path: Path) -> str:
        return self._relative(path)


    def _decode_hf_cache_name(self, name: str) -> str:
        if name.startswith("models--"):
            return name.removeprefix("models--").replace("--", "/")
        return name


    def _model_item(self, path: Path, *, label: str, provider: str = "", backend: str = "", model_name: str = "") -> StorageModelItemModel:
        size, count = self._tree_stats(path)
        return StorageModelItemModel(
            id=self._model_id(path),
            label=label,
            provider=provider,
            backend=backend,
            model_name=model_name,
            relative_path=self._relative(path),
            bytes=size,
            file_count=count,
            updated_at=self._mtime_iso(path),
            active=self._runtime_busy(),
        )


    def _model_items(self) -> list[StorageModelItemModel]:
        models_root = self.layout.models_root
        if not models_root.exists():
            return []
        records = self._manifest_records()
        items: list[StorageModelItemModel] = []
        seen: set[str] = set()

        provider_roots = [
            (models_root / "transcriber" / "providers" / "huggingface" / "hub", "HuggingFace"),
            (models_root / "transcriber" / "providers" / "faster_whisper" / "hub", "Faster Whisper"),
        ]
        for hub_root, provider_label in provider_roots:
            if not hub_root.exists() or hub_root.is_symlink() or not hub_root.is_dir():
                continue
            for child in sorted(hub_root.iterdir()):
                if not self._is_hf_model_cache_dir(child):
                    continue
                record = self._record_for_model_path(child, records)
                model_name = str(record.get("effective_model_name") or self._decode_hf_cache_name(child.name)) if record else self._decode_hf_cache_name(child.name)
                backend = str(record.get("backend") or "") if record else ""
                provider = str(record.get("provider") or provider_label) if record else provider_label
                item = self._model_item(child, label=model_name, provider=provider, backend=backend, model_name=model_name)
                items.append(item)
                seen.add(item.relative_path)

        for record in records:
            resolved_model_dir = record.get("resolved_model_dir")
            if not isinstance(resolved_model_dir, str) or not resolved_model_dir:
                continue
            model_path = Path(resolved_model_dir).expanduser().resolve()
            if not model_path.exists() or not self._is_relative_to(model_path, models_root):
                continue
            if self._is_ignored_model_child(model_path) or self._item_path_is_covered(model_path, items):
                continue
            model_name = str(record.get("effective_model_name") or model_path.name)
            item = self._model_item(
                model_path,
                label=model_name,
                provider=str(record.get("provider") or "py-roller"),
                backend=str(record.get("backend") or "transcriber"),
                model_name=model_name,
            )
            items.append(item)
            seen.add(item.relative_path)

        torch_root = models_root / "torch"
        if torch_root.exists():
            children = sorted(torch_root.iterdir()) if torch_root.is_dir() and not torch_root.is_symlink() else []
            visible_children = [child for child in children if self._is_model_item_candidate(child)]
            if visible_children:
                for child in visible_children:
                    item = self._model_item(child, label=f"Torch / Demucs: {child.name}", provider="Torch", backend="demucs")
                    items.append(item)
                    seen.add(item.relative_path)
            elif torch_root.is_dir() and not self._is_ignored_model_child(torch_root):
                item = self._model_item(torch_root, label="Torch / Demucs", provider="Torch", backend="demucs")
                items.append(item)
                seen.add(item.relative_path)

        for child in sorted(models_root.iterdir()):
            if child.name in {"transcriber", "torch"} or not self._is_model_item_candidate(child):
                continue
            item = self._model_item(child, label=child.name, provider="Other", backend="")
            items.append(item)
            seen.add(item.relative_path)

        transcriber_root = models_root / "transcriber"
        if transcriber_root.exists() and transcriber_root.is_dir() and not transcriber_root.is_symlink():
            for child in sorted(transcriber_root.iterdir()):
                if child.name in {"providers", "manifests"} or not self._is_model_item_candidate(child):
                    continue
                if self._item_path_is_covered(child, items):
                    continue
                item = self._model_item(child, label=f"Transcriber {child.name}", provider="py-roller", backend="transcriber")
                if item.relative_path not in seen:
                    items.append(item)
                    seen.add(item.relative_path)

        items.sort(key=lambda item: item.bytes, reverse=True)
        return items


    def _runtime_items(self) -> list[StorageRuntimeItemModel]:
        envs = self.layout.runtime_root
        if not envs.exists():
            return []
        active_runtime_id = self._active_runtime_id()
        runtime_busy = self._runtime_busy()
        items: list[StorageRuntimeItemModel] = []
        for runtime_root in sorted(path for path in envs.iterdir() if path.is_dir() or path.is_symlink()):
            payload: dict = {}
            runtime_json = runtime_root / "runtime.json"
            if runtime_json.exists():
                try:
                    payload = json.loads(runtime_json.read_text(encoding="utf-8"))
                except Exception:
                    payload = {}
            size, count = self._tree_stats(runtime_root)
            active = runtime_root.name == active_runtime_id
            items.append(
                StorageRuntimeItemModel(
                    runtime_id=runtime_root.name,
                    profile=str(payload.get("profile") or runtime_root.name.rsplit("-", 1)[-1]),
                    status=str(payload.get("last_install_status") or payload.get("last_doctor_status") or ("active" if active else "installed")),
                    pyroller_version=payload.get("pyroller_version") if isinstance(payload.get("pyroller_version"), str) else None,
                    python_version=payload.get("python_version") if isinstance(payload.get("python_version"), str) else None,
                    relative_path=self._relative(runtime_root),
                    bytes=size,
                    file_count=count,
                    updated_at=self._mtime_iso(runtime_root),
                    active=active,
                    removable=not active and not runtime_busy,
                )
            )
        items.sort(key=lambda item: (not item.active, item.runtime_id))
        return items


    def _other_items(self) -> list[StorageOtherItemModel]:
        excluded = {"projects", "models", "envs"}
        for root in (self.layout.projects_root, self.layout.models_root, self.layout.runtime_root, self.layout.work_root):
            try:
                if root.resolve(strict=False).parent == self.data_dir.resolve(strict=False):
                    excluded.add(root.name)
            except OSError:
                continue
        if not self.data_dir.exists():
            return []
        items: list[StorageOtherItemModel] = []
        for child in sorted(self.data_dir.iterdir()):
            if child.name in excluded:
                continue
            if self._is_ignored_other_child(child):
                continue
            size, count = self._tree_stats(child)
            if count == 0 and size == 0 and child.name in {"cache", "settings.json"}:
                continue
            items.append(
                StorageOtherItemModel(
                    label=self._other_label(child),
                    relative_path=self._relative(child),
                    bytes=size,
                    file_count=count,
                    updated_at=self._mtime_iso(child),
                    removable=child.name != "settings.json" and not child.is_symlink() and not (child.name == "cache" and self._runtime_busy()),
                )
            )
        cache_root = self.layout.cache_root.resolve(strict=False)
        if not self._is_relative_to(cache_root, self.data_dir.resolve(strict=False)):
            size, count = self._tree_stats(self.layout.cache_root)
            if size or count:
                items.append(
                    StorageOtherItemModel(
                        label="External Cache",
                        relative_path="cache",
                        bytes=size,
                        file_count=count,
                        updated_at=self._mtime_iso(self.layout.cache_root),
                        removable=not self._runtime_busy(),
                    )
                )
        items.sort(key=lambda item: item.bytes, reverse=True)
        return items


    def _is_ignored_other_child(self, path: Path) -> bool:
        name = path.name
        return name in IGNORED_OTHER_NAMES or name.startswith("._")


    def _other_label(self, path: Path) -> str:
        if path.name == "settings.json":
            return "Settings File"
        if path.name == "cache":
            return "External Cache"
        return path.name


    def _other_item_for_path(self, relative_path: str) -> StorageOtherItemModel:
        item = next((item for item in self._other_items() if item.relative_path == relative_path), None)
        if item is None:
            raise FileNotFoundError(f"Other storage item not found: {relative_path}")
        return item
