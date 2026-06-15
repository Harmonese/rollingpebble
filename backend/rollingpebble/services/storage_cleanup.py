from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path
from typing import Iterable

from rollingpebble import job_kinds
from rollingpebble.messages import message_from_exception, message_from_text
from rollingpebble.models import (
    StorageCleanupEntryModel,
    StorageCleanupFailureModel,
    StorageCleanupPlanResponse,
    StorageCleanupPreviewRequest,
    StorageCleanupRunRequest,
    StorageCleanupRunResponse,
)
from rollingpebble.services.storage_shared import (
    AUDIO_PREFIX,
    GENERATED_DIRS,
    PLAN_TTL_SECONDS,
    CachedCleanupPlan,
)
from rollingpebble.storage.files import PLAIN_NAME, PROJECT_JSON, PYROLLER_NAME, SYNCED_NAME, read_project, write_project


class StorageCleanupMixin:
    def preview(self, request: StorageCleanupPreviewRequest) -> StorageCleanupPlanResponse:
        targets = list(dict.fromkeys(request.targets or ["clean_models"]))
        older_than_days = request.older_than_days
        project_ids = list(dict.fromkeys(request.project_ids or []))
        model_ids = list(dict.fromkeys(request.model_ids or []))
        runtime_ids = list(dict.fromkeys(request.runtime_ids or []))
        other_paths = list(dict.fromkeys(request.other_paths or []))
        entries: list[StorageCleanupEntryModel] = []
        warnings: list[str] = []

        for target in targets:
            if target == "delete_projects":
                entries.extend(self._delete_project_entries(project_ids))
                warnings.append("Selected projects and all files inside them will be deleted.")
            elif target == "clear_intermediate":
                # Project-scoped intermediate cleanup is driven by the already-filtered
                # project list in the UI. Do not apply the directory mtime filter again.
                entries.extend(self._project_intermediate_entries(project_ids or None, None if project_ids else older_than_days))
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
            elif target == "clean_external_cache":
                entries.extend(self._other_entries(["cache"]))
                warnings.append("External tool caches may be downloaded or rebuilt again when needed.")
            elif target == "delete_other_items":
                entries.extend(self._other_entries(other_paths))
                warnings.append("Selected other app data will be deleted.")
            elif target == "delete_project_audio":
                entries.extend(self._project_audio_entries(project_ids))
                warnings.append("Projects without local audio cannot run Auto Timing until audio is imported again.")
            elif target == "delete_project_lyrics_output":
                entries.extend(self._project_lyrics_output_entries(project_ids))
            # Compatibility for plans created by older frontends.
            elif target == "safe":
                entries.extend(self._project_generated_entries(project_ids or None, older_than_days, intermediate_only=True))
                entries.extend(self._other_entries(["cache"]))
            elif target == "job_intermediates":
                entries.extend(self._project_generated_entries(project_ids or None, older_than_days, intermediate_only=True))
            elif target == "project_artifacts":
                entries.extend(self._project_generated_entries(project_ids or None, older_than_days, artifacts_only=True))
            elif target == "model_cache":
                entries.extend(self._model_cache_entries())
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
            warning_messages=[message_from_text(warning) for warning in list(dict.fromkeys(warnings))],
        )
        self._plans[plan.plan_id] = CachedCleanupPlan(plan=plan)
        self._prune_plans()
        return plan


    def run(self, request: StorageCleanupRunRequest) -> StorageCleanupRunResponse:
        cached = self._plans.get(request.plan_id)
        if cached is None or time.time() - cached.created_at > PLAN_TTL_SECONDS:
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
                        error_message=message_from_exception(exc),
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
        expired = [plan_id for plan_id, cached in self._plans.items() if now - cached.created_at > PLAN_TTL_SECONDS]
        for plan_id in expired:
            self._plans.pop(plan_id, None)
        if len(self._plans) <= 20:
            return
        for plan_id, _ in sorted(self._plans.items(), key=lambda item: item[1].created_at)[: len(self._plans) - 20]:
            self._plans.pop(plan_id, None)


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
            reason_message=message_from_text(reason),
            removable=removable and size >= 0,
        )


    def _absolute_from_relative(self, relative_path: str) -> Path:
        raw = Path(relative_path)
        if raw.is_absolute():
            return raw
        parts = raw.parts
        if parts:
            root_map = {
                "projects": self.layout.projects_root,
                "models": self.layout.models_root,
                "envs": self.layout.runtime_root,
                "cache": self.layout.cache_root,
                "work": self.layout.work_root,
            }
            root = root_map.get(parts[0])
            if root is not None:
                path = root.joinpath(*parts[1:])
                resolved = path.resolve(strict=False)
                try:
                    resolved.relative_to(root.resolve(strict=False))
                except ValueError as exc:
                    raise RuntimeError("Cleanup path escaped the rollingpebble data directory.") from exc
                return path
        path = self.data_dir / relative_path
        resolved = path.resolve(strict=False)
        try:
            resolved.relative_to(self.data_dir)
        except ValueError as exc:
            raise RuntimeError("Cleanup path escaped the rollingpebble data directory.") from exc
        return path


    def _project_audio_paths(self, project_dir: Path) -> list[Path]:
        return sorted(path for path in project_dir.iterdir() if path.is_file() and path.name.startswith(AUDIO_PREFIX)) if project_dir.exists() else []


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
        return [job for job in self.jobs.list() if job_kinds.is_running(job)]


    def _runtime_busy(self) -> bool:
        blocked_kinds = {
            job_kinds.AUTO_TIMING,
            job_kinds.RUNTIME_INSTALL,
            job_kinds.RUNTIME_DOCTOR,
        }
        return any(job.kind in blocked_kinds for job in self._running_jobs())


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
        manifest_path = self.layout.models_root / "transcriber" / "manifests" / "transcriber-index.json"
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


    def _other_entries(self, relative_paths: Iterable[str]) -> list[StorageCleanupEntryModel]:
        entries: list[StorageCleanupEntryModel] = []
        for relative_path in relative_paths:
            try:
                item = self._other_item_for_path(relative_path)
            except FileNotFoundError:
                continue
            path = self._absolute_from_relative(item.relative_path)
            removable = item.removable
            reason = "Delete this other app data item."
            risk = "caution"
            if item.relative_path == "settings.json":
                removable = False
                risk = "blocked"
                reason = "storage_reason.settings_file_protected"
            elif item.relative_path == "cache":
                risk = "safe"
                reason = "External tool cache data can be downloaded or rebuilt again."
                if not item.removable:
                    risk = "blocked"
                    reason = "Runtime or Auto Timing work is running; External Cache is locked."
            entries.append(
                self._entry(
                    category="other",
                    path=path,
                    label=item.label,
                    risk=risk,
                    reason=reason,
                    removable=removable,
                )
            )
        return entries


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


    def _model_cache_entries(self, model_ids: Iterable[str] | None = None) -> list[StorageCleanupEntryModel]:
        models_root = self.layout.models_root
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


    def _runtime_entries(self, runtime_ids: Iterable[str] | None = None) -> list[StorageCleanupEntryModel]:
        envs = self.layout.runtime_root
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
        allowed_roots = [
            self.layout.app_root,
            self.layout.projects_root,
            self.layout.models_root,
            self.layout.cache_root,
            self.layout.runtime_root,
            self.layout.work_root,
        ]
        if not any(self._is_relative_to(resolved, root.resolve(strict=False)) for root in allowed_roots):
            raise RuntimeError("Cleanup path escaped the rollingpebble data directory.")
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
            models_root = self.layout.models_root.resolve(strict=False)
            if not self._is_relative_to(resolved, models_root):
                raise RuntimeError("Model cleanup can only delete managed model cache paths.")
            if Path(entry.relative_path).parts == ("models",):
                raise RuntimeError("Refusing to delete the top-level models directory directly.")
            return
        if entry.category == "other":
            if len(parts) != 1:
                raise RuntimeError("Other cleanup can only delete top-level data directory items.")
            if parts[0] in {"projects", "models", "envs"}:
                raise RuntimeError("Other cleanup cannot delete managed storage categories.")
            if parts[0] == "settings.json":
                raise RuntimeError("storage_reason.settings_file_protected")
            if self._is_ignored_other_child(path):
                raise RuntimeError("Ignored system files are not cleanup targets.")
            if parts[0] == "cache" and self._runtime_busy():
                raise RuntimeError("Runtime or Auto Timing work is running; External Cache is locked.")
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
            if len(parts) != 3 or parts[2] not in GENERATED_DIRS:
                raise RuntimeError("Project generated cleanup can only delete intermediate or artifacts roots.")
            return
        if entry.category == "project_audio":
            if len(parts) != 3 or not parts[2].startswith(AUDIO_PREFIX):
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
                project.audio_ref = None
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
