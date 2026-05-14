from __future__ import annotations

import json
import shutil
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from lrc_roller.jobs import JobManager
from lrc_roller.models import (
    JobStatus,
    ProjectModel,
    StorageCategoryModel,
    StorageCleanupEntryModel,
    StorageCleanupFailureModel,
    StorageCleanupPlanResponse,
    StorageCleanupPreviewRequest,
    StorageCleanupRunRequest,
    StorageCleanupRunResponse,
    StorageModelItemModel,
    StorageOtherItemModel,
    StorageProjectModel,
    StorageRuntimeItemModel,
    StorageUsageResponse,
)
from lrc_roller.services.runtime_manager import RuntimeManager
from lrc_roller.storage.app_settings import SettingsStore
from lrc_roller.storage.files import AUDIO_NAME, PLAIN_NAME, PROJECT_JSON, PYROLLER_NAME, SYNCED_NAME, read_project, write_project


@dataclass(slots=True)
class _CachedPlan:
    plan: StorageCleanupPlanResponse
    created_at: float = field(default_factory=time.time)


_CATEGORY_LABELS: dict[str, str] = {
    "projects": "Projects",
    "models": "Models",
    "runtime_envs": "Runtime Environments",
    "other": "Other",
}

_CATEGORY_DESCRIPTIONS: dict[str, str] = {
    "projects": "Project folders, including audio, lyrics, outputs, artifacts, and intermediates.",
    "models": "Downloaded model caches under the lrc-roller models directory.",
    "runtime_envs": "Isolated py-roller Python environments.",
    "other": "Unmanaged files and folders under the lrc-roller data directory.",
}

_RUNNING_STATUSES = {JobStatus.queued, JobStatus.running, "queued", "running"}
_AUDIO_PREFIX = f"{AUDIO_NAME}."
_LYRICS_OUTPUT_FILES = {PROJECT_JSON, PLAIN_NAME, SYNCED_NAME, PYROLLER_NAME}
_GENERATED_DIRS = {"intermediate", "artifacts"}
_PLAN_TTL_SECONDS = 30 * 60
_MODEL_PROVIDER_DIRS = {"providers", "huggingface", "faster_whisper", "hub"}
_IGNORED_MODEL_NAMES = {".DS_Store", ".locks", ".Spotlight-V100", ".Trashes", ".fseventsd"}


class StorageService:
    def __init__(self, *, data_dir: Path, jobs: JobManager, runtime_manager: RuntimeManager | None = None) -> None:
        self.data_dir = data_dir.expanduser().resolve()
        self.projects_root = self.data_dir / "projects"
        self.jobs = jobs
        self.runtime_manager = runtime_manager or RuntimeManager(self.data_dir)
        self.settings_store = SettingsStore(self.data_dir)
        self._plans: dict[str, _CachedPlan] = {}

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

    def usage(self) -> StorageUsageResponse:
        total_bytes, total_count = self._tree_stats(self.data_dir)
        projects = self._project_summaries()
        model_items = self._model_items()
        runtime_items = self._runtime_items()
        other_items = self._other_items()
        categories = [
            self._category_from_stats("projects", sum(item.total_bytes for item in projects), sum(item.file_count for item in projects), self.projects_root),
            self._category("models", [self.data_dir / "models"]),
            self._category("runtime_envs", [self.data_dir / "envs"]),
            self._category_from_stats("other", sum(item.bytes for item in other_items), sum(item.file_count for item in other_items), self.data_dir),
        ]
        return StorageUsageResponse(
            data_dir=str(self.data_dir),
            total_bytes=total_bytes,
            file_count=total_count,
            categories=categories,
            projects=projects,
            models=model_items,
            runtimes=runtime_items,
            other_items=other_items,
        )

    def preview(self, request: StorageCleanupPreviewRequest) -> StorageCleanupPlanResponse:
        targets = list(dict.fromkeys(request.targets or ["clean_generated"]))
        older_than_days = request.older_than_days
        project_ids = list(dict.fromkeys(request.project_ids or []))
        model_ids = list(dict.fromkeys(request.model_ids or []))
        runtime_ids = list(dict.fromkeys(request.runtime_ids or []))
        entries: list[StorageCleanupEntryModel] = []
        warnings: list[str] = []

        for target in targets:
            if target == "delete_projects":
                entries.extend(self._delete_project_entries(project_ids))
                warnings.append("Selected projects and all files inside them will be deleted.")
            elif target == "clear_intermediate":
                entries.extend(self._project_intermediate_entries(project_ids or None, older_than_days))
            elif target == "clean_models":
                entries.extend(self._model_cache_entries(model_ids or None))
                warnings.append("Models will be downloaded again when needed.")
            elif target == "delete_model_items":
                entries.extend(self._model_cache_entries(model_ids or []))
                warnings.append("Selected models will be downloaded again when needed.")
            elif target == "clean_runtime_envs":
                entries.extend(self._runtime_entries(runtime_ids or None))
                warnings.append("Deleted inactive runtimes can be recreated with Create / Repair Runtime.")
            elif target == "clean_project_generated":
                entries.extend(self._project_generated_entries(project_ids, older_than_days))
            elif target == "delete_project_audio":
                entries.extend(self._project_audio_entries(project_ids))
                warnings.append("Projects without local audio cannot run Auto Timing until audio is imported again.")
            elif target == "delete_project_lyrics_output":
                entries.extend(self._project_lyrics_output_entries(project_ids))
            elif target == "clean_generated":
                entries.extend(self._global_generated_entries(older_than_days))
            elif target == "clean_tool_caches":
                entries.extend(self._tool_cache_entries())
            # Compatibility for plans created by older frontends.
            elif target == "safe":
                entries.extend(self._project_generated_entries(project_ids or None, older_than_days, intermediate_only=True))
                entries.extend(self._global_generated_entries(older_than_days, include_tool_caches=False))
            elif target == "job_intermediates":
                entries.extend(self._project_generated_entries(project_ids or None, older_than_days, intermediate_only=True))
            elif target == "project_artifacts":
                entries.extend(self._project_generated_entries(project_ids or None, older_than_days, artifacts_only=True))
            elif target == "model_cache":
                entries.extend(self._model_cache_entries())
            elif target == "external_caches":
                entries.extend(self._tool_cache_entries())
            elif target == "runtime_envs":
                entries.extend(self._runtime_entries())

        entries = self._dedupe_entries(entries)
        plan = StorageCleanupPlanResponse(
            plan_id=f"storage_cleanup_{uuid.uuid4().hex[:12]}",
            targets=targets,
            total_reclaimable_bytes=sum(entry.bytes for entry in entries if entry.removable),
            entry_count=len(entries),
            entries=entries,
            warnings=list(dict.fromkeys(warnings)),
        )
        self._plans[plan.plan_id] = _CachedPlan(plan=plan)
        self._prune_plans()
        return plan

    def run(self, request: StorageCleanupRunRequest) -> StorageCleanupRunResponse:
        cached = self._plans.get(request.plan_id)
        if cached is None or time.time() - cached.created_at > _PLAN_TTL_SECONDS:
            raise KeyError(f"Cleanup plan not found or expired: {request.plan_id}")
        selected = set(request.entry_ids or [entry.id for entry in cached.plan.entries if entry.removable])
        deleted_bytes = 0
        deleted_count = 0
        skipped_count = 0
        failed: list[StorageCleanupFailureModel] = []
        for entry in cached.plan.entries:
            if entry.id not in selected:
                continue
            try:
                path = self._absolute_from_relative(entry.relative_path)
                self._validate_entry_for_deletion(entry, path)
                if not path.exists() and not path.is_symlink():
                    skipped_count += 1
                    continue
                before_bytes, _ = self._tree_stats(path)
                if path.is_symlink():
                    raise RuntimeError("Refusing to delete symbolic links during cleanup.")
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
                self._apply_project_metadata_after_delete(entry)
                if entry.category == "model_cache":
                    self._prune_transcriber_manifest_for_deleted_model(path)
                deleted_bytes += before_bytes or entry.bytes
                deleted_count += 1
            except Exception as exc:
                failed.append(
                    StorageCleanupFailureModel(
                        entry_id=entry.id,
                        relative_path=entry.relative_path,
                        error=str(exc),
                    )
                )
        return StorageCleanupRunResponse(
            plan_id=request.plan_id,
            deleted_bytes=deleted_bytes,
            deleted_count=deleted_count,
            skipped_count=skipped_count,
            failed=failed,
            usage=self.usage(),
        )

    def _prune_plans(self) -> None:
        now = time.time()
        expired = [plan_id for plan_id, cached in self._plans.items() if now - cached.created_at > _PLAN_TTL_SECONDS]
        for plan_id in expired:
            self._plans.pop(plan_id, None)
        if len(self._plans) <= 20:
            return
        for plan_id, _ in sorted(self._plans.items(), key=lambda item: item[1].created_at)[: len(self._plans) - 20]:
            self._plans.pop(plan_id, None)

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
            label=_CATEGORY_LABELS[category_id],
            bytes=bytes_,
            file_count=file_count,
            path=str(path),
            description=_CATEGORY_DESCRIPTIONS[category_id],
        )

    def _tree_stats(self, path: Path) -> tuple[int, int]:
        try:
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

    def _entry(self, *, category: str, path: Path, label: str, risk: str, reason: str, removable: bool = True) -> StorageCleanupEntryModel:
        size, count = self._tree_stats(path)
        if path.is_symlink():
            removable = False
            risk = "blocked"
            reason = f"Symbolic links are not followed or removed: {reason}"
        return StorageCleanupEntryModel(
            id=f"entry_{uuid.uuid4().hex[:12]}",
            category=category,
            label=label,
            relative_path=self._relative(path),
            bytes=size,
            file_count=count,
            risk=risk,  # type: ignore[arg-type]
            reason=reason,
            removable=removable and size >= 0,
        )

    def _relative(self, path: Path) -> str:
        try:
            return path.relative_to(self.data_dir).as_posix()
        except ValueError:
            return path.as_posix()

    def _absolute_from_relative(self, relative_path: str) -> Path:
        path = self.data_dir / relative_path
        resolved = path.resolve(strict=False)
        try:
            resolved.relative_to(self.data_dir)
        except ValueError as exc:
            raise RuntimeError("Cleanup path escaped the lrc-roller data directory.") from exc
        return path

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
            lyrics_output_paths = [project_dir / name for name in _LYRICS_OUTPUT_FILES if (project_dir / name).exists()]
            generated_paths = [project_dir / name for name in _GENERATED_DIRS if (project_dir / name).exists()]
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

    def _sum_stats(self, paths: Iterable[Path]) -> tuple[int, int]:
        total_bytes = 0
        total_count = 0
        for path in paths:
            size, count = self._tree_stats(path)
            total_bytes += size
            total_count += count
        return total_bytes, total_count

    def _project_audio_paths(self, project_dir: Path) -> list[Path]:
        return sorted(path for path in project_dir.iterdir() if path.is_file() and path.name.startswith(_AUDIO_PREFIX)) if project_dir.exists() else []

    def _project_paths_for_ids(self, project_ids: Iterable[str] | None) -> list[Path]:
        if project_ids is None:
            return self._project_dirs()
        allowed_ids = {project.name for project in self._project_dirs()}
        paths = []
        for project_id in project_ids:
            if project_id in allowed_ids:
                paths.append(self.projects_root / project_id)
        return paths

    def _active_project_ids(self) -> set[str]:
        return {str(job.project_id) for job in self._running_jobs() if job.project_id}

    def _running_jobs(self):
        if not hasattr(self.jobs, "list"):
            return []
        return [job for job in self.jobs.list() if job.status in _RUNNING_STATUSES]

    def _runtime_busy(self) -> bool:
        return any(job.kind in {"auto-timing", "auto-roller-runtime-install", "auto-roller-doctor"} for job in self._running_jobs())

    def _active_runtime_id(self) -> str:
        try:
            settings = self.settings_store.read()
            return self.runtime_manager.runtime_id(settings.auto_roller_profile)
        except Exception:
            return self.runtime_manager.runtime_id("auto")

    def _is_older_than(self, path: Path, days: int | None) -> bool:
        if days is None or days <= 0:
            return True
        try:
            age_seconds = time.time() - path.stat().st_mtime
        except OSError:
            return False
        return age_seconds >= days * 86400

    def _global_generated_usage_paths(self) -> list[Path]:
        paths: list[Path] = []
        cache = self.data_dir / "cache"
        if cache.exists():
            paths.extend(child for child in cache.iterdir() if child.name not in {"pip", "xdg"})
        paths.extend([self.data_dir / "logs", self.data_dir / "uploads", self.data_dir / "outputs"])
        return paths

    def _model_roots(self) -> list[Path]:
        return [self.data_dir / "models"]

    def _manifest_records(self) -> list[dict]:
        manifest_path = self.data_dir / "models" / "transcriber" / "manifests" / "transcriber-index.json"
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
        return name in _IGNORED_MODEL_NAMES or name.startswith("._") or name.startswith(".")

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
        models_root = self.data_dir / "models"
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

    def _manifest_record_matches_deleted_path(self, record: dict, deleted_path: Path) -> bool:
        for key in ("resolved_model_dir",):
            value = record.get(key)
            if not isinstance(value, str) or not value:
                continue
            candidate = Path(value).expanduser().resolve()
            if self._paths_overlap(candidate, deleted_path):
                return True
        return False

    def _prune_transcriber_manifest_for_deleted_model(self, deleted_path: Path) -> None:
        manifest_path = self.data_dir / "models" / "transcriber" / "manifests" / "transcriber-index.json"
        if not manifest_path.exists() or manifest_path.is_symlink():
            return
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            return
        models = data.get("models")
        if not isinstance(models, dict):
            return
        deleted_resolved = deleted_path.resolve(strict=False)
        keys_to_remove = [key for key, record in models.items() if isinstance(record, dict) and self._manifest_record_matches_deleted_path(record, deleted_resolved)]
        if not keys_to_remove:
            return
        for key in keys_to_remove:
            models.pop(key, None)
        try:
            manifest_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            return

    def _runtime_items(self) -> list[StorageRuntimeItemModel]:
        envs = self.data_dir / "envs"
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
        if not self.data_dir.exists():
            return []
        items: list[StorageOtherItemModel] = []
        for child in sorted(self.data_dir.iterdir()):
            if child.name in excluded:
                continue
            size, count = self._tree_stats(child)
            items.append(
                StorageOtherItemModel(
                    label=child.name,
                    relative_path=self._relative(child),
                    bytes=size,
                    file_count=count,
                    updated_at=self._mtime_iso(child),
                )
            )
        items.sort(key=lambda item: item.bytes, reverse=True)
        return items

    def _tool_cache_roots(self) -> list[Path]:
        return [self.data_dir / "cache" / "pip", self.data_dir / "cache" / "xdg"]

    def _delete_project_entries(self, project_ids: list[str]) -> list[StorageCleanupEntryModel]:
        entries: list[StorageCleanupEntryModel] = []
        active_projects = self._active_project_ids()
        for project in self._project_paths_for_ids(project_ids):
            active = project.name in active_projects
            entries.append(
                self._entry(
                    category="project",
                    path=project,
                    label=self._project_label(project),
                    risk="blocked" if active else "danger",
                    reason="This project has a running job." if active else "Delete the project and all files inside it.",
                    removable=not active,
                )
            )
        return entries

    def _project_intermediate_entries(self, project_ids: Iterable[str] | None, older_than_days: int | None) -> list[StorageCleanupEntryModel]:
        entries: list[StorageCleanupEntryModel] = []
        active_projects = self._active_project_ids()
        for project in self._project_paths_for_ids(project_ids):
            active = project.name in active_projects
            path = project / "intermediate"
            if not path.exists():
                continue
            if not self._is_older_than(path, older_than_days):
                continue
            entries.append(
                self._entry(
                    category="project_intermediate",
                    path=path,
                    label=f"{self._project_label(project)} intermediate",
                    risk="blocked" if active else "safe",
                    reason="This project has a running job." if active else "Clear this project's intermediate files.",
                    removable=not active,
                )
            )
        return entries

    def _project_generated_entries(
        self,
        project_ids: Iterable[str] | None,
        older_than_days: int | None,
        *,
        intermediate_only: bool = False,
        artifacts_only: bool = False,
    ) -> list[StorageCleanupEntryModel]:
        entries: list[StorageCleanupEntryModel] = []
        active_projects = self._active_project_ids()
        names = ["intermediate", "artifacts"]
        if intermediate_only:
            names = ["intermediate"]
        if artifacts_only:
            names = ["artifacts"]
        for project in self._project_paths_for_ids(project_ids):
            active = project.name in active_projects
            for name in names:
                path = project / name
                if not path.exists():
                    continue
                if not self._is_older_than(path, older_than_days):
                    continue
                entries.append(
                    self._entry(
                        category="project_generated",
                        path=path,
                        label=f"{self._project_label(project)} {name}",
                        risk="blocked" if active else "safe",
                        reason="This project has a running job." if active else "Generated Auto Timing files can be recreated.",
                        removable=not active,
                    )
                )
        return entries

    def _project_audio_entries(self, project_ids: list[str]) -> list[StorageCleanupEntryModel]:
        entries: list[StorageCleanupEntryModel] = []
        active_projects = self._active_project_ids()
        for project in self._project_paths_for_ids(project_ids):
            active = project.name in active_projects
            for path in self._project_audio_paths(project):
                entries.append(
                    self._entry(
                        category="project_audio",
                        path=path,
                        label=f"{self._project_label(project)} audio",
                        risk="blocked" if active else "caution",
                        reason="This project has a running job." if active else "Delete this project's local audio file.",
                        removable=not active,
                    )
                )
        return entries

    def _project_lyrics_output_entries(self, project_ids: list[str]) -> list[StorageCleanupEntryModel]:
        entries: list[StorageCleanupEntryModel] = []
        active_projects = self._active_project_ids()
        for project in self._project_paths_for_ids(project_ids):
            active = project.name in active_projects
            for name in (PLAIN_NAME, SYNCED_NAME, PYROLLER_NAME):
                path = project / name
                if not path.exists():
                    continue
                entries.append(
                    self._entry(
                        category="project_lyrics_output",
                        path=path,
                        label=f"{self._project_label(project)} {name}",
                        risk="blocked" if active else "caution",
                        reason="This project has a running job." if active else "Delete this project's lyrics and Auto Timing output files.",
                        removable=not active,
                    )
                )
        return entries

    def _global_generated_entries(self, older_than_days: int | None, *, include_tool_caches: bool = True) -> list[StorageCleanupEntryModel]:
        entries: list[StorageCleanupEntryModel] = []
        for parent_name in ("cache", "logs", "uploads", "outputs"):
            parent = self.data_dir / parent_name
            if not parent.exists():
                continue
            for child in sorted(parent.iterdir()):
                if child.name in {"pip", "xdg"}:
                    if include_tool_caches:
                        # Tool caches have their own target and label.
                        continue
                    continue
                if not self._is_older_than(child, older_than_days):
                    continue
                entries.append(
                    self._entry(
                        category="generated",
                        path=child,
                        label=f"{parent_name}/{child.name}",
                        risk="safe",
                        reason="Application-generated cache, log, upload, or output content.",
                    )
                )
        return entries

    def _model_cache_entries(self, model_ids: Iterable[str] | None = None) -> list[StorageCleanupEntryModel]:
        models_root = self.data_dir / "models"
        if self._runtime_busy():
            return [
                self._entry(
                    category="model_cache",
                    path=models_root,
                    label="Model cache",
                    risk="blocked",
                    reason="Auto Timing or runtime maintenance is running.",
                    removable=False,
                )
            ]
        allowed = {item.id: item for item in self._model_items()}
        selected_ids = set(model_ids or allowed.keys())
        entries: list[StorageCleanupEntryModel] = []
        for model_id in selected_ids:
            item = allowed.get(model_id)
            if item is None:
                continue
            entries.append(
                self._entry(
                    category="model_cache",
                    path=self.data_dir / item.relative_path,
                    label=item.label,
                    risk="danger",
                    reason="Downloaded models may need to be downloaded again.",
                )
            )
        return entries

    def _tool_cache_entries(self) -> list[StorageCleanupEntryModel]:
        entries: list[StorageCleanupEntryModel] = []
        for cache_root in self._tool_cache_roots():
            if not cache_root.exists():
                continue
            entries.append(
                self._entry(
                    category="tool_cache",
                    path=cache_root,
                    label=cache_root.name,
                    risk="safe",
                    reason="Tool cache redirected under the lrc-roller data directory.",
                )
            )
        return entries

    def _runtime_entries(self, runtime_ids: Iterable[str] | None = None) -> list[StorageCleanupEntryModel]:
        envs = self.data_dir / "envs"
        if not envs.exists():
            return []
        active_runtime_id = self._active_runtime_id()
        selected_ids = set(runtime_ids or [item.runtime_id for item in self._runtime_items()])
        entries: list[StorageCleanupEntryModel] = []
        runtime_busy = self._runtime_busy()
        for runtime_root in sorted(path for path in envs.iterdir() if path.is_dir() or path.is_symlink()):
            if runtime_root.name not in selected_ids:
                continue
            active = runtime_root.name == active_runtime_id
            blocked = active or runtime_busy
            reason = "Current runtime is protected." if active else "Runtime work is running." if runtime_busy else "Inactive runtime can be recreated."
            entries.append(
                self._entry(
                    category="runtime_envs",
                    path=runtime_root,
                    label=runtime_root.name,
                    risk="blocked" if blocked else "danger",
                    reason=reason,
                    removable=not blocked,
                )
            )
        return entries

    def _project_label(self, project_dir: Path) -> str:
        project = self._read_project_metadata(project_dir.name)
        if project:
            title = project.metadata.track or project.audio_name or project.project_id
            return f"{title} ({project.project_id})"
        return project_dir.name

    def _dedupe_entries(self, entries: list[StorageCleanupEntryModel]) -> list[StorageCleanupEntryModel]:
        seen_paths: set[str] = set()
        deduped: list[StorageCleanupEntryModel] = []
        for entry in entries:
            if entry.relative_path in seen_paths:
                continue
            seen_paths.add(entry.relative_path)
            deduped.append(entry)
        return deduped

    def _validate_entry_for_deletion(self, entry: StorageCleanupEntryModel, path: Path) -> None:
        if not entry.removable:
            raise RuntimeError("This cleanup entry is not removable.")
        if path.is_symlink():
            raise RuntimeError("Refusing to delete symbolic links during cleanup.")
        resolved = path.resolve(strict=False)
        try:
            resolved.relative_to(self.data_dir)
        except ValueError as exc:
            raise RuntimeError("Cleanup path escaped the lrc-roller data directory.") from exc
        parts = Path(entry.relative_path).parts
        if not parts:
            raise RuntimeError("Invalid cleanup path.")
        active_projects = self._active_project_ids()
        if len(parts) >= 2 and parts[0] == "projects":
            if parts[1] in active_projects:
                raise RuntimeError("This project has a running job.")
            self._validate_project_entry(entry, parts)
            return
        if entry.category in {"model_cache", "runtime_envs"} and self._runtime_busy():
            raise RuntimeError("Runtime or Auto Timing work is running; this category is locked.")
        if entry.category == "runtime_envs":
            if len(parts) != 2 or parts[0] != "envs":
                raise RuntimeError("Runtime cleanup can only delete runtime roots.")
            if path.name == self._active_runtime_id():
                raise RuntimeError("Current runtime is protected.")
            return
        if entry.category == "model_cache":
            models_root = (self.data_dir / "models").resolve(strict=False)
            if not self._is_relative_to(resolved, models_root):
                raise RuntimeError("Model cleanup can only delete managed model cache paths.")
            if Path(entry.relative_path).parts == ("models",):
                raise RuntimeError("Refusing to delete the top-level models directory directly.")
            return
        if entry.category == "tool_cache":
            if path not in self._tool_cache_roots():
                raise RuntimeError("Tool cache cleanup can only delete managed tool cache roots.")
            return
        if entry.category == "generated":
            if parts[0] not in {"cache", "logs", "uploads", "outputs"}:
                raise RuntimeError("Generated cleanup can only delete application-generated roots.")
            if len(parts) < 2:
                raise RuntimeError("Refusing to delete a top-level generated folder directly.")
            if parts[0] == "cache" and parts[1] in {"pip", "xdg"}:
                raise RuntimeError("Tool caches must be cleaned through Tool Caches.")
            return
        raise RuntimeError("Cleanup path is not in an allowed cleanup location.")

    def _validate_project_entry(self, entry: StorageCleanupEntryModel, parts: tuple[str, ...]) -> None:
        project_id = parts[1]
        project_dir = self.projects_root / project_id
        if not project_dir.exists():
            return
        if entry.category == "project":
            if len(parts) != 2:
                raise RuntimeError("Project delete can only delete a project root.")
            return
        if entry.category == "project_intermediate":
            if len(parts) != 3 or parts[2] != "intermediate":
                raise RuntimeError("Project intermediate cleanup can only delete the intermediate root.")
            return
        if entry.category == "project_generated":
            if len(parts) != 3 or parts[2] not in _GENERATED_DIRS:
                raise RuntimeError("Project generated cleanup can only delete intermediate or artifacts roots.")
            return
        if entry.category == "project_audio":
            if len(parts) != 3 or not parts[2].startswith(_AUDIO_PREFIX):
                raise RuntimeError("Project audio cleanup can only delete audio files.")
            return
        if entry.category == "project_lyrics_output":
            if len(parts) != 3 or parts[2] not in {PLAIN_NAME, SYNCED_NAME, PYROLLER_NAME}:
                raise RuntimeError("Project lyrics cleanup can only delete lyrics/output files.")
            return
        raise RuntimeError("Unsupported project cleanup entry.")

    def _apply_project_metadata_after_delete(self, entry: StorageCleanupEntryModel) -> None:
        parts = Path(entry.relative_path).parts
        if len(parts) < 2 or parts[0] != "projects":
            return
        project_id = parts[1]
        if entry.category == "project":
            return
        project_dir = self.projects_root / project_id
        if not (project_dir / PROJECT_JSON).exists():
            return
        try:
            project = read_project(self.projects_root, project_id)
            if entry.category == "project_audio" and not self._project_audio_paths(project_dir):
                project.audio_name = None
                project.audio_path = None
                write_project(self.projects_root, project)
            elif entry.category == "project_lyrics_output":
                if not (project_dir / PLAIN_NAME).exists():
                    project.plain_lyrics = ""
                if not (project_dir / SYNCED_NAME).exists():
                    project.synced_lyrics = ""
                write_project(self.projects_root, project)
        except (OSError, json.JSONDecodeError, ValueError):
            return

    @staticmethod
    def _is_relative_to(path: Path, parent: Path) -> bool:
        try:
            path.relative_to(parent)
            return True
        except ValueError:
            return False
