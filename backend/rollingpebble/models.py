from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class MetaModel(BaseModel):
    track: str = ""
    artist: str = ""
    album: str = ""
    duration: int = 0


class MetadataSources(BaseModel):
    track: Literal["audio", "manual", "lyrics"] | None = None
    artist: Literal["audio", "manual", "lyrics"] | None = None
    album: Literal["audio", "manual", "lyrics"] | None = None


class DocumentLine(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(max_length=10000)
    time: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    translation: str = Field(default="", max_length=20000)
    source_text: str = Field(default="", max_length=10000)


class LyricDocument(BaseModel):
    version: Literal[1] = 1
    source_lrc: str
    target_language: str = Field(default="", max_length=100)
    lines: list[DocumentLine] = Field(max_length=2000)


class ProjectModel(BaseModel):
    lyric_document: LyricDocument | None = None
    project_id: str
    last_opened_at: str | None = None
    audio_name: str | None = None
    audio_ref: str | None = None
    audio_path: str | None = None
    metadata: MetaModel = Field(default_factory=MetaModel)
    metadata_sources: MetadataSources | None = None
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


class MessageModel(BaseModel):
    code: str
    params: dict[str, Any] = Field(default_factory=dict)
    fallback: str = ""



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
    lyric_document: LyricDocument | None = None
    plain_lyrics: str = ""
    synced_lyrics: str = ""
    source: str = "manual"
    lrclib_id: int | None = None
    metadata: MetaModel | None = None
    metadata_sources: MetadataSources | None = None


class SaveEditorRequest(BaseModel):
    lyric_document: LyricDocument | None = None
    plain_lyrics: str = ""
    synced_lyrics: str = ""
    metadata: MetaModel | None = None
    metadata_sources: MetadataSources | None = None


class WorkspaceSaveRequest(SaveEditorRequest):
    source: str = "manual"
    lrclib_id: int | None = None


class AudioMetadataRequest(BaseModel):
    filename: str
    metadata: MetaModel = Field(default_factory=MetaModel)




class JobProgressModel(BaseModel):
    stage: str = ""
    event_type: str = ""
    completed: int = 0
    total: int = 0
    unit: str = ""
    message: str = ""
    message_message: MessageModel | None = None
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
    cancelling = "cancelling"
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
    error_message: MessageModel | None = None
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
    translation_connection: dict = Field(default_factory=dict)
    storage_layout_version: int = 3
    auto_timing_v2_options: dict = Field(default_factory=lambda: {"alignment_mode": "ordered", "language": "auto"})
    model_prepared_kinds: list[Literal["whisper", "ctc", "ctc-zh", "ctc-mul", "demucs"]] = Field(default_factory=lambda: ["whisper", "ctc", "demucs"])

    auto_roller_profile: Literal["auto"] = "auto"
    auto_fill_lyrics_library_from_project_metadata: bool = True
    auto_cleanup_imported_lyrics: bool = False
    # Kept for compatibility with older settings.json files.
    editor_show_metadata: bool = True
    editor_write_metadata_tags: bool = True
    upload_derive_plain_from_synced: bool = True




    auto_timing_hf_proxy: str = ""
    model_download_source: Literal["modelscope", "official"] = "modelscope"
    model_proxy_enabled: bool = False
    model_onboarding_complete: bool = False
    auto_timing_hf_etag_timeout: int | None = None
    auto_timing_hf_download_timeout: int | None = Field(default=None, ge=1, le=30)




    recent_projects_limit: int = 8

    audio_filename_regex: str = ""
    audio_filename_regex_enabled: bool = False

    last_doctor_status: str | None = None
    last_doctor_at: str | None = None
    last_install_profile: str | None = None
    last_install_at: str | None = None
    last_install_status: str | None = None


class AutoRollerRuntimeResponse(BaseModel):
    startup_preparation: bool = False
    preparation: dict = Field(default_factory=dict)
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
    detail_message: MessageModel | None = None
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


class RuntimeSettingsUpdateRequest(BaseModel):
    auto_timing_v2_options: dict | None = None

    auto_fill_lyrics_library_from_project_metadata: bool | None = None
    auto_cleanup_imported_lyrics: bool | None = None
    editor_show_metadata: bool | None = None
    editor_write_metadata_tags: bool | None = None
    upload_derive_plain_from_synced: bool | None = None




    auto_timing_hf_proxy: str | None = None
    model_download_source: Literal["modelscope", "official"] | None = None
    model_proxy_enabled: bool | None = None
    model_onboarding_complete: bool | None = None
    model_prepared_kinds: list[Literal["whisper", "ctc", "ctc-zh", "ctc-mul", "demucs"]] | None = None
    auto_timing_hf_etag_timeout: int | None = None
    auto_timing_hf_download_timeout: int | None = Field(default=None, ge=1, le=30)




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
    reason_message: MessageModel | None = None
    plain_lines: int = 0
    synced_lines: int = 0
    warnings: list[str] = Field(default_factory=list)
    warning_messages: list[MessageModel] = Field(default_factory=list)
    payload_preview: dict[str, Any] = Field(default_factory=dict)


class UploadRunRequest(UploadPlanRequest):
    pass


class UploadRunResponse(BaseModel):
    success: bool
    message: str
    message_message: MessageModel | None = None


class StorageProjectModel(BaseModel):
    project_id: str
    title: str = ""
    artist: str = ""
    updated_at: str | None = None
    total_bytes: int = 0
    file_count: int = 0


class StorageCategoryModel(BaseModel):
    id: Literal["projects", "models", "results", "cache", "components"]
    label: str
    bytes: int = 0
    file_count: int = 0
    path: str = ""


class StorageUsageResponse(BaseModel):
    data_dir: str
    migration: dict = Field(default_factory=lambda: {"status": "idle"})
    total_bytes: int = 0
    file_count: int = 0
    categories: list[StorageCategoryModel] = Field(default_factory=list)
    projects: list[StorageProjectModel] = Field(default_factory=list)
