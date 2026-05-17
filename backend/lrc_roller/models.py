from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class MetaModel(BaseModel):
    track: str = ""
    artist: str = ""
    album: str = ""
    duration: int = 0


class ProjectModel(BaseModel):
    project_id: str
    last_opened_at: str | None = None
    audio_name: str | None = None
    audio_path: str | None = None
    metadata: MetaModel = Field(default_factory=MetaModel)
    plain_lyrics: str = ""
    synced_lyrics: str = ""
    source: str = "manual"
    lrclib_id: int | None = None


class HealthDependency(BaseModel):
    available: bool
    version: str | None = None
    detail: str | None = None


class HealthResponse(BaseModel):
    ok: bool
    port: int
    data_dir: str
    pylrclib: HealthDependency
    pyroller: HealthDependency




class NeteaseSongSearchRequest(BaseModel):
    query: str | None = None
    track: str | None = None
    artist: str | None = None
    album: str | None = None
    limit: int = 10


class NeteaseResolveRequest(BaseModel):
    value: str


class NeteaseSongModel(BaseModel):
    id: int
    name: str = ""
    artists: str = ""
    album: str = ""
    duration: int = 0
    label: str = ""
    song_url: str = ""
    wiki_url: str = ""
    outer_audio_url: str = ""
    playback_url: str = ""


class NeteaseSearchResponse(BaseModel):
    results: list[NeteaseSongModel] = Field(default_factory=list)


class NeteaseResolveResponse(BaseModel):
    song: NeteaseSongModel


class NeteaseLyricResponse(BaseModel):
    lyric: str | None = None
    tlyric: str | None = None


class LrclibSearchRequest(BaseModel):
    query: str | None = None
    title: str | None = None
    track: str | None = None
    artist: str | None = None
    album: str | None = None
    limit: int = 10


class LrclibGetRequest(BaseModel):
    track: str
    artist: str
    album: str = ""
    duration: int = 0


class LrclibIdRequest(BaseModel):
    lrclib_id: int


class LrcCleanseRequest(BaseModel):
    text: str
    remove_translations: bool = True


class LrcCleanseResponse(BaseModel):
    status: str
    cleaned_text: str | None = None
    plain_lyrics: str = ""
    is_instrumental: bool = False
    has_valid_timestamps: bool = False
    warnings: list[str] = Field(default_factory=list)
    reason: str | None = None


class LyricsRecordModel(BaseModel):
    id: int | None = None
    track_name: str = ""
    artist_name: str = ""
    album_name: str = ""
    duration: int | None = None
    plain_lyrics: str = ""
    synced_lyrics: str = ""
    instrumental: bool = False
    has_plain: bool = False
    has_synced: bool = False
    label: str = ""


class LrclibSearchResponse(BaseModel):
    results: list[LyricsRecordModel]


class LrclibGetResponse(BaseModel):
    record: LyricsRecordModel | None = None
    duration_diff: int | None = None
    duration_ok: bool = False
    source: str = "external"


class ApplyLyricsRequest(BaseModel):
    plain_lyrics: str = ""
    synced_lyrics: str = ""
    source: str = "manual"
    lrclib_id: int | None = None
    metadata: MetaModel | None = None


class SaveEditorRequest(BaseModel):
    plain_lyrics: str = ""
    synced_lyrics: str = ""
    metadata: MetaModel | None = None


class RollRequest(BaseModel):
    language: Literal["zh", "en", "mul"] = "zh"
    # UI should prefer business-level presets, but keep raw stages for
    # backward compatibility with older frontends and saved settings.
    stages: str | None = None

    splitter_backend: str | None = None
    splitter_demucs_model: str | None = None
    splitter_demucs_device: str | None = None
    splitter_demucs_jobs: int | None = None
    splitter_demucs_overlap: float | None = None
    splitter_demucs_segment: float | None = None

    filter_chain: str | None = None

    transcriber_backend: str | None = None
    transcriber_device: str | None = None
    transcriber_model_name: str | None = None
    transcriber_model_path: str | None = None
    transcriber_local_files_only: bool | None = None
    transcriber_compute_type: str | None = None
    transcriber_batch_size: int | None = None
    transcriber_hf_xet: Literal["auto", "on", "off"] | None = None
    transcriber_hf_proxy: str | None = None
    transcriber_hf_etag_timeout: int | None = None
    transcriber_hf_download_timeout: int | None = None
    transcriber_hf_max_workers: int | None = None
    transcriber_vad_filter: bool = False

    parser_lyrics_encoding: str | None = None

    aligner_backend: str | None = None
    aligner_min_gap: float | None = None
    aligner_repetition: Literal["none", "few", "full"] | None = None

    writer_backend: str = "lrc_ms"
    writer_spacing: Literal["keep", "drop"] = "keep"
    writer_by_tag: str | None = None
    writer_ass_karaoke_tag_type: Literal["k", "K", "kf", "ko"] | None = None

    cleanup: Literal["on-success", "never"] = "on-success"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"


class BatchRollRequest(RollRequest):
    project_ids: list[str] = Field(min_length=1)
    continue_on_error: bool = False
    skip_existing: bool = False


class RollPreviewResponse(BaseModel):
    command: list[str]
    command_text: str
    warnings: list[str] = Field(default_factory=list)
    output_path: str | None = None
    intermediate_dir: str | None = None


class JobProgressModel(BaseModel):
    stage: str = ""
    event_type: str = ""
    completed: int = 0
    total: int = 0
    unit: str = ""
    message: str = ""
    percent: float | None = None
    progress: float | None = None
    raw: str = ""
    done: bool = False
    failed: bool = False
    bytes_downloaded: int | None = None
    bytes_total: int | None = None
    bytes_per_second: float | None = None
    repo_id: str | None = None
    cache_dir: str | None = None
    detail: dict[str, Any] = Field(default_factory=dict)


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    canceled = "canceled"


class JobModel(BaseModel):
    job_id: str
    kind: str
    project_id: str | None = None
    status: JobStatus
    command: list[str] = Field(default_factory=list)
    logs: list[str] = Field(default_factory=list)
    result: dict[str, Any] | None = None
    error: str | None = None
    progress: JobProgressModel | None = None
    completed_stages: list[str] = Field(default_factory=list)
    events: list[dict[str, Any]] = Field(default_factory=list)
    pid: int | None = None
    return_code: int | None = None
    started_at: str | None = None
    updated_at: str | None = None
    last_output_at: str | None = None


class LocalPathRequest(BaseModel):
    mode: Literal["file", "directory"] = "directory"
    title: str = "Select path"
    initial_path: str | None = None


class LocalPathResponse(BaseModel):
    path: str = ""
    canceled: bool = False


class RuntimeSettingsModel(BaseModel):
    auto_roller_profile: Literal["auto", "cpu", "cu124"] = "auto"
    auto_fill_lyrics_library_from_project_metadata: bool = True
    auto_cleanup_imported_lyrics: bool = False
    # Kept for compatibility with older settings.json files.
    editor_show_metadata: bool = True
    editor_write_metadata_tags: bool = True
    upload_derive_plain_from_synced: bool = True

    auto_timing_default_language: Literal["zh", "en", "mul"] = "zh"
    auto_timing_default_stages: str = "s,f,t,p,a,w"
    auto_timing_default_writer_backend: str = "lrc_ms"
    auto_timing_default_writer_spacing: Literal["keep", "drop"] = "keep"
    auto_timing_default_cleanup: Literal["on-success", "never"] = "on-success"
    auto_timing_default_log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    auto_timing_splitter_backend: str = "demucs"
    auto_timing_splitter_demucs_model: str = "htdemucs"
    auto_timing_splitter_demucs_device: str = ""
    auto_timing_splitter_demucs_jobs: int | None = None
    auto_timing_splitter_demucs_overlap: float | None = None
    auto_timing_splitter_demucs_segment: float | None = None

    auto_timing_filter_chain: str = ""

    auto_timing_transcriber_backend: str = "faster_whisper"
    auto_timing_transcriber_device: str = "cpu"
    auto_timing_transcriber_model_name: str = "large-v2"
    auto_timing_model_store: str = ""
    auto_timing_transcriber_compute_type: str = "int8"
    auto_timing_transcriber_batch_size: int | None = 8
    auto_timing_local_files_only_default: bool = False
    auto_timing_hf_xet: Literal["auto", "on", "off"] = "off"
    auto_timing_hf_proxy: str = ""
    auto_timing_hf_etag_timeout: int | None = None
    auto_timing_hf_download_timeout: int | None = None
    auto_timing_hf_max_workers: int | None = None
    auto_timing_transcriber_vad_filter: bool = False

    auto_timing_parser_lyrics_encoding: str = "auto"

    auto_timing_aligner_backend: str = "global_dp_v1"
    auto_timing_aligner_min_gap: float | None = 0.5
    auto_timing_aligner_repetition: Literal["none", "few", "full"] = "none"

    auto_timing_writer_by_tag: str = "LRC Roller"
    auto_timing_writer_ass_karaoke_tag_type: Literal["", "k", "K", "kf", "ko"] = "kf"

    recent_projects_limit: int = 8

    audio_filename_regex: str = ""
    audio_filename_regex_enabled: bool = False

    last_doctor_status: str | None = None
    last_doctor_at: str | None = None
    last_install_profile: str | None = None
    last_install_at: str | None = None
    last_install_status: str | None = None


class AutoRollerRuntimeResponse(BaseModel):
    engine: str = "py-roller"
    mode: str = "isolated"
    available: bool
    version: str | None = None
    cli_path: str | None = None
    python_executable: str
    data_dir: str
    model_store: str
    settings: RuntimeSettingsModel
    detail: str | None = None
    runtime_id: str | None = None
    runtime_status: str = "missing"
    runtime_profile: str | None = None
    runtime_root: str | None = None
    runtime_venv: str | None = None
    runtime_python: str | None = None
    runtime_source: str | None = None
    runtime_requirement: str | None = None
    doctor_report: dict[str, Any] | None = None
    install_report: dict[str, Any] | None = None


class RuntimeInstallRequest(BaseModel):
    profile: Literal["auto", "cpu", "cu124"] = "auto"
    skip_doctor: bool = False
    # Kept for compatibility with older frontends. v0.5.0 always creates or repairs
    # the isolated runtime; dry-run is intentionally ignored.
    dry_run: bool = False


class RuntimeUpgradeRequest(BaseModel):
    profile: Literal["auto", "cpu", "cu124"] = "auto"


class ModelCacheRequest(BaseModel):
    language: Literal["zh", "en", "mul"] = "mul"
    transcriber_backend: str | None = None
    transcriber_model_name: str | None = None
    transcriber_model_path: str | None = None


class RuntimeSettingsUpdateRequest(BaseModel):
    auto_roller_profile: Literal["auto", "cpu", "cu124"] | None = None
    auto_fill_lyrics_library_from_project_metadata: bool | None = None
    auto_cleanup_imported_lyrics: bool | None = None
    editor_show_metadata: bool | None = None
    editor_write_metadata_tags: bool | None = None
    upload_derive_plain_from_synced: bool | None = None

    auto_timing_default_language: Literal["zh", "en", "mul"] | None = None
    auto_timing_default_stages: str | None = None
    auto_timing_default_writer_backend: str | None = None
    auto_timing_default_writer_spacing: Literal["keep", "drop"] | None = None
    auto_timing_default_cleanup: Literal["on-success", "never"] | None = None
    auto_timing_default_log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] | None = None

    auto_timing_splitter_backend: str | None = None
    auto_timing_splitter_demucs_model: str | None = None
    auto_timing_splitter_demucs_device: str | None = None
    auto_timing_splitter_demucs_jobs: int | None = None
    auto_timing_splitter_demucs_overlap: float | None = None
    auto_timing_splitter_demucs_segment: float | None = None

    auto_timing_filter_chain: str | None = None

    auto_timing_transcriber_backend: str | None = None
    auto_timing_transcriber_device: str | None = None
    auto_timing_transcriber_model_name: str | None = None
    auto_timing_model_store: str | None = None
    auto_timing_transcriber_compute_type: str | None = None
    auto_timing_transcriber_batch_size: int | None = None
    auto_timing_local_files_only_default: bool | None = None
    auto_timing_hf_xet: Literal["auto", "on", "off"] | None = None
    auto_timing_hf_proxy: str | None = None
    auto_timing_hf_etag_timeout: int | None = None
    auto_timing_hf_download_timeout: int | None = None
    auto_timing_hf_max_workers: int | None = None
    auto_timing_transcriber_vad_filter: bool | None = None

    auto_timing_parser_lyrics_encoding: str | None = None

    auto_timing_aligner_backend: str | None = None
    auto_timing_aligner_min_gap: float | None = None
    auto_timing_aligner_repetition: Literal["none", "few", "full"] | None = None

    auto_timing_writer_by_tag: str | None = None
    auto_timing_writer_ass_karaoke_tag_type: Literal["", "k", "K", "kf", "ko"] | None = None

    recent_projects_limit: int | None = None

    audio_filename_regex: str | None = None
    audio_filename_regex_enabled: bool | None = None


class UploadPlanRequest(BaseModel):
    mode: Literal["auto", "plain", "synced", "mixed", "instrumental"] = "auto"
    allow_derived_plain: bool = True
    metadata: MetaModel | None = None
    plain_lyrics: str | None = None
    synced_lyrics: str | None = None


class UploadPlanResponse(BaseModel):
    can_upload: bool
    mode: str
    reason: str
    plain_lines: int = 0
    synced_lines: int = 0
    warnings: list[str] = Field(default_factory=list)
    payload_preview: dict[str, Any] = Field(default_factory=dict)


class UploadRunRequest(UploadPlanRequest):
    pass


class UploadRunResponse(BaseModel):
    success: bool
    message: str


CleanupTarget = Literal[
    "clean_models",
    "delete_model_items",
    "clean_runtime_envs",
    "delete_projects",
    "clear_intermediate",
    "clean_project_generated",
    "clean_external_cache",
    "delete_other_items",
    "delete_project_audio",
    "delete_project_lyrics_output",
    # Backward-compatible project/model/runtime target names used by older frontends/tests.
    "safe",
    "job_intermediates",
    "project_artifacts",
    "model_cache",
    "runtime_envs",
]


class StorageProjectModel(BaseModel):
    project_id: str
    title: str = ""
    artist: str = ""
    album: str = ""
    audio_name: str | None = None
    updated_at: str | None = None
    audio_bytes: int = 0
    lyrics_output_bytes: int = 0
    generated_bytes: int = 0
    intermediate_bytes: int = 0
    total_bytes: int = 0
    file_count: int = 0
    audio_file_count: int = 0
    lyrics_output_file_count: int = 0
    generated_file_count: int = 0
    intermediate_file_count: int = 0
    has_audio: bool = False
    has_lyrics_output: bool = False
    has_generated: bool = False
    has_intermediate: bool = False
    active: bool = False




class StorageModelItemModel(BaseModel):
    id: str
    label: str
    provider: str = ""
    backend: str = ""
    model_name: str = ""
    relative_path: str
    bytes: int = 0
    file_count: int = 0
    updated_at: str | None = None
    active: bool = False


class StorageRuntimeItemModel(BaseModel):
    runtime_id: str
    profile: str = ""
    status: str = "unknown"
    pyroller_version: str | None = None
    python_version: str | None = None
    relative_path: str
    bytes: int = 0
    file_count: int = 0
    updated_at: str | None = None
    active: bool = False
    removable: bool = True


class StorageOtherItemModel(BaseModel):
    label: str
    relative_path: str
    bytes: int = 0
    file_count: int = 0
    updated_at: str | None = None
    removable: bool = True


class StorageCategoryModel(BaseModel):
    id: str
    label: str
    bytes: int = 0
    file_count: int = 0
    path: str = ""
    description: str = ""


class StorageUsageResponse(BaseModel):
    data_dir: str
    total_bytes: int = 0
    file_count: int = 0
    categories: list[StorageCategoryModel] = Field(default_factory=list)
    projects: list[StorageProjectModel] = Field(default_factory=list)
    models: list[StorageModelItemModel] = Field(default_factory=list)
    runtimes: list[StorageRuntimeItemModel] = Field(default_factory=list)
    other_items: list[StorageOtherItemModel] = Field(default_factory=list)


class StorageCleanupPreviewRequest(BaseModel):
    targets: list[CleanupTarget] = Field(default_factory=lambda: ["clean_models"])
    older_than_days: int | None = 1
    project_ids: list[str] = Field(default_factory=list)
    model_ids: list[str] = Field(default_factory=list)
    runtime_ids: list[str] = Field(default_factory=list)
    other_paths: list[str] = Field(default_factory=list)


class StorageCleanupEntryModel(BaseModel):
    id: str
    category: str
    label: str
    relative_path: str
    bytes: int = 0
    file_count: int = 0
    risk: Literal["safe", "caution", "danger", "blocked"] = "safe"
    reason: str = ""
    removable: bool = True


class StorageCleanupPlanResponse(BaseModel):
    plan_id: str
    targets: list[str] = Field(default_factory=list)
    total_reclaimable_bytes: int = 0
    entry_count: int = 0
    entries: list[StorageCleanupEntryModel] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class StorageCleanupRunRequest(BaseModel):
    plan_id: str
    entry_ids: list[str] | None = None


class StorageCleanupFailureModel(BaseModel):
    entry_id: str
    relative_path: str
    error: str


class StorageCleanupRunResponse(BaseModel):
    plan_id: str
    deleted_bytes: int = 0
    deleted_count: int = 0
    skipped_count: int = 0
    failed: list[StorageCleanupFailureModel] = Field(default_factory=list)
    usage: StorageUsageResponse | None = None


class StorageOpenModelRequest(BaseModel):
    model_id: str


class StorageOpenRuntimeRequest(BaseModel):
    runtime_id: str


class StorageOpenOtherRequest(BaseModel):
    relative_path: str
