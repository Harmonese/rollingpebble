from __future__ import annotations

import re
from typing import Any

from rollingpebble.models import MessageModel


class AppError(Exception):
    def __init__(self, code: str, fallback: str = "", *, params: dict[str, Any] | None = None) -> None:
        super().__init__(fallback or code)
        self.message = MessageModel(code=code, params=params or {}, fallback=fallback or code)


def msg(code: str, fallback: str = "", **params: Any) -> MessageModel:
    return MessageModel(code=code, params=params, fallback=fallback or code)


_EXACT_CODES: dict[str, str] = {
    "Project has no audio file": "project.no_audio",
    "Project audio file is missing": "project.audio_missing",
    "This job is not attached to a project folder.": "job.not_project_attached",
    "No background available.": "settings.background_missing",
    "No lyric lines to time. Import or paste lyrics first.": "auto_timing.no_lyrics",
    "Missing alignment_result.json. Run an alignment step first.": "auto_timing.missing_alignment_result",
    "Task complete": "job.task_complete",
    "Runtime ready": "runtime.ready",
    "Automatic timing complete": "auto_timing.complete",
    "Isolated runtime has not been created yet.": "runtime.detail_missing",
    "Runtime Python exists, but py-roller is not installed in it.": "runtime.detail_broken",
    "Runtime exists, but the last doctor check reported problems.": "runtime.detail_unhealthy",
    "Runtime exists, but no successful doctor check has been recorded yet.": "runtime.detail_unchecked",
    "Auto Timing runtime is not ready. Create or repair the isolated runtime in Settings before running py-roller.": "runtime.not_ready_run",
    "Auto Timing runtime is not ready. Create or repair the isolated runtime in Settings before upgrading.": "runtime.not_ready_upgrade",
    "Auto Timing runtime is not ready. Create or repair the isolated runtime in Settings before caching models.": "runtime.not_ready_cache",
    "Legacy PATH py-roller is ignored; rollingpebble uses an isolated runtime.": "runtime.legacy_path_ignored",
    "The isolated Auto Timing runtime is being created or repaired. Wait for it to finish before starting Auto Timing.": "runtime.install_running_wait",
    "An Auto Timing or Batch job is already running.": "auto_timing.already_running",
    "Isolated Auto Timing runtime is not configured.": "runtime.not_configured",
    "Isolated Auto Timing runtime is not ready.": "runtime.not_ready",
    "Runtime installation is already running. Wait for it to finish before running Runtime Check.": "runtime.install_running_check",
    "Runtime Check is already running.": "runtime.check_running",
    "Isolated Auto Timing runtime is not ready. Create or repair it before running Runtime Check.": "runtime.not_ready_check",
    "Auto Timing is running. Cancel or wait for it before upgrading the runtime.": "runtime.auto_timing_running_upgrade",
    "Runtime installation is already running.": "runtime.install_running",
    "Runtime upgrade is already running.": "runtime.upgrade_running",
    "Isolated Auto Timing runtime is not ready. Create or repair it before upgrading.": "runtime.not_ready_upgrade",
    "Auto Timing is running. Cancel or wait for it before caching a model.": "runtime.auto_timing_running_cache",
    "Model caching is already running.": "runtime.cache_running",
    "Auto Timing is running. Cancel or wait for it before repairing the runtime.": "runtime.auto_timing_running_repair",
    "Runtime Check is running. Wait for it before repairing the runtime.": "runtime.check_running_repair",
    "This cleanup entry is not removable.": "storage.cleanup.not_removable",
    "Refusing to delete symbolic links during cleanup.": "storage.cleanup.symbolic_link",
    "Cleanup path escaped the rollingpebble data directory.": "storage.cleanup.path_escaped",
    "Invalid cleanup path.": "storage.cleanup.invalid_path",
    "This project has a running job.": "storage.cleanup.project_running",
    "Runtime or Auto Timing work is running; this category is locked.": "storage.cleanup.category_locked",
    "Runtime cleanup can only delete runtime roots.": "storage.cleanup.runtime_roots_only",
    "Current runtime is protected.": "storage.cleanup.current_runtime_protected",
    "Model cleanup can only delete managed model cache paths.": "storage.cleanup.model_paths_only",
    "Refusing to delete the top-level models directory directly.": "storage.cleanup.models_root_protected",
    "Other cleanup can only delete top-level data directory items.": "storage.cleanup.other_top_level_only",
    "Other cleanup cannot delete managed storage categories.": "storage.cleanup.other_managed_protected",
    "storage_reason.settings_file_protected": "storage.cleanup.settings_file_protected",
    "Ignored system files are not cleanup targets.": "storage.cleanup.ignored_system_file",
    "Runtime or Auto Timing work is running; External Cache is locked.": "storage.cleanup.external_cache_locked",
    "Cleanup path is not in an allowed cleanup location.": "storage.cleanup.location_not_allowed",
    "Project delete can only delete a project root.": "storage.cleanup.project_root_only",
    "Project intermediate cleanup can only delete the intermediate root.": "storage.cleanup.project_intermediate_root_only",
    "Project generated cleanup can only delete intermediate or artifacts roots.": "storage.cleanup.project_generated_roots_only",
    "Project audio cleanup can only delete audio files.": "storage.cleanup.project_audio_only",
    "Project lyrics cleanup can only delete lyrics/output files.": "storage.cleanup.project_lyrics_only",
    "Unsupported project cleanup entry.": "storage.cleanup.unsupported_project_entry",
    "Storage roots cannot be moved while jobs are running.": "storage.migration.jobs_running",
    "Target path is already the active storage location.": "storage.migration.same_path",
    "Target path cannot be inside the current storage root or contain it.": "storage.migration.nested_path",
    "Target directory must be empty.": "storage.migration.target_not_empty",
    "Selected projects and all files inside them will be deleted.": "storage.warning.delete_projects",
    "Models will be downloaded again when needed.": "storage.warning.clean_models",
    "Selected models will be downloaded again when needed.": "storage.warning.delete_models",
    "Deleted inactive runtimes can be recreated with Create / Repair Runtime.": "storage.warning.delete_runtimes",
    "External tool caches may be downloaded or rebuilt again when needed.": "storage.warning.external_cache",
    "Selected other app data will be deleted.": "storage.warning.delete_other",
    "Projects without local audio cannot run Auto Timing until audio is imported again.": "storage.warning.delete_audio",
    "Delete this other app data item.": "storage.reason.delete_other",
    "External tool cache data can be downloaded or rebuilt again.": "storage.reason.external_cache",
    "Delete the project and all files inside it.": "storage.reason.delete_project",
    "Clear this project's intermediate files.": "storage.reason.clear_intermediate",
    "Generated Auto Timing files can be recreated.": "storage.reason.generated_recreatable",
    "Delete this project's local audio file.": "storage.reason.delete_audio",
    "Delete this project's lyrics and Auto Timing output files.": "storage.reason.delete_lyrics_output",
    "Auto Timing or runtime maintenance is running.": "storage.reason.runtime_maintenance_running",
    "Downloaded models may need to be downloaded again.": "storage.reason.downloaded_models",
    "Runtime work is running.": "storage.reason.runtime_work_running",
    "Inactive runtime can be recreated.": "storage.reason.inactive_runtime",
    "missing_track": "upload.warning.missing_track",
    "missing_artist": "upload.warning.missing_artist",
    "missing_duration": "upload.warning.missing_duration",
    "empty_lyrics": "upload.warning.empty_lyrics",
    "instrumental uploaded": "upload.run.instrumental_uploaded",
    "instrumental upload failed": "upload.run.instrumental_failed",
}


def message_from_text(text: str, *, default_code: str = "system.error") -> MessageModel:
    if text in _EXACT_CODES:
        return msg(_EXACT_CODES[text], text)
    project_match = re.match(r"^Project not found: (?P<project_id>.+)$", text)
    if project_match:
        return msg("project.not_found", text, project_id=project_match.group("project_id"))
    job_match = re.match(r"^Job not found: (?P<job_id>.+)$", text)
    if job_match:
        return msg("job.not_found", text, job_id=job_match.group("job_id"))
    command_match = re.match(r"^Command exited with code (?P<code>\d+)$", text)
    if command_match:
        return msg("job.command_exited", text, code=command_match.group("code"))
    cleanup_match = re.match(r"^Cleanup plan not found or expired: (?P<plan_id>.+)$", text)
    if cleanup_match:
        return msg("storage.cleanup.plan_missing", text, plan_id=cleanup_match.group("plan_id"))
    unsupported_root_match = re.match(r"^Storage root cannot be moved: (?P<root_id>.+)$", text)
    if unsupported_root_match:
        return msg("storage.migration.unsupported_root", text, root_id=unsupported_root_match.group("root_id"))
    unknown_root_match = re.match(r"^Unknown storage root: (?P<root_id>.+)$", text)
    if unknown_root_match:
        return msg("storage.migration.unknown_root", text, root_id=unknown_root_match.group("root_id"))
    audio_match = re.match(r"^Audio file not found: (?P<path>.+)$", text)
    if audio_match:
        return msg("project.audio_file_not_found", text, path=audio_match.group("path"))
    missing_artifact = re.match(r"^Missing (?P<name>.+)\\. Run a full pipeline first\\.$", text)
    if missing_artifact:
        return msg("auto_timing.missing_artifact_full_pipeline", text, name=missing_artifact.group("name"))
    output_match = re.match(r"^Auto timing did not create (?P<path>.+)$", text)
    if output_match:
        return msg("auto_timing.output_missing", text, path=output_match.group("path"))
    symlink_match = re.match(r"^Symbolic links are not followed or removed: (?P<reason>.+)$", text)
    if symlink_match:
        return msg("storage.reason.symbolic_link", text, reason=symlink_match.group("reason"))
    upload_skipped = re.match(r"^Upload skipped: (?P<reason>.*); warnings=(?P<warnings>.*)$", text)
    if upload_skipped:
        return msg("upload.run.skipped", text, reason=upload_skipped.group("reason"), warnings=upload_skipped.group("warnings"))
    return msg(default_code, text, message=text)


def message_from_exception(exc: Exception, *, default_code: str = "system.error") -> MessageModel:
    if isinstance(exc, AppError):
        return exc.message
    return message_from_text(str(exc), default_code=default_code)
