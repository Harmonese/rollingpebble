export type MetaModel = {
    track: string;
    artist: string;
    album: string;
    duration: number;
};

export type MetadataSources = Partial<Record<"track" | "artist" | "album", "audio" | "manual" | "lyrics" | null>>;

export type ProjectModel = {
    lyric_document?: import("../../domain/lyrics/translationDocument.js").LyricDocument | null;
    project_id: string;
    last_opened_at?: string | null;
    audio_name?: string | null;
    audio_ref?: string | null;
    audio_path?: string | null;
    metadata: MetaModel;
    metadata_sources?: MetadataSources | null;
    plain_lyrics: string;
    synced_lyrics: string;
    source: string;
    lrclib_id?: number | null;
};

export type LyricsRecord = {
    id?: number | null;
    track_name: string;
    artist_name: string;
    album_name: string;
    duration?: number | null;
    plain_lyrics: string;
    synced_lyrics: string;
    instrumental: boolean;
    has_plain: boolean;
    has_synced: boolean;
    label: string;
};

export type NeteaseLyricResponse = {
    lyric?: string | null;
    tlyric?: string | null;
};

export type NeteaseSong = {
    id: number;
    name: string;
    artists: string;
    album: string;
    duration: number;
    label: string;
    song_url: string;
    wiki_url: string;
    outer_audio_url: string;
    playback_url: string;
};

export type HealthResponse = {
    ok: boolean;
    port: number;
    data_dir: string;
    pylrclib: { available: boolean; version?: string | null; detail?: string | null };
    pyroller: { available: boolean; version?: string | null; detail?: string | null };
};

export type BackendMessage = {
    code: string;
    params?: Record<string, string | number | boolean | null>;
    fallback?: string;
};

export type JobProgress = {
    stage: string;
    event_type?: string;
    completed: number;
    total: number;
    unit: string;
    message: string;
    message_message?: BackendMessage | null;
    percent?: number | null;
    progress?: number | null;
    raw: string;
    done: boolean;
    failed: boolean;
    bytes_downloaded?: number | null;
    bytes_total?: number | null;
    bytes_per_second?: number | null;
    repo_id?: string | null;
    cache_dir?: string | null;
    detail?: Record<string, unknown>;
};

export type JobModel = {
    job_id: string;
    kind: string;
    project_id?: string | null;
    status: "queued" | "running" | "cancelling" | "succeeded" | "failed" | "canceled";
    command: string[];
    logs: string[];
    result?: Record<string, unknown> | null;
    error?: string | null;
    error_message?: BackendMessage | null;
    progress?: JobProgress | null;
    completed_stages: string[];
    events?: Record<string, unknown>[];
    pid?: number | null;
    return_code?: number | null;
    started_at?: string | null;
    updated_at?: string | null;
    last_output_at?: string | null;
};

export type UploadPlan = {
    can_upload: boolean;
    mode: string;
    reason: string;
    reason_message?: BackendMessage | null;
    plain_lines: number;
    synced_lines: number;
    warnings: string[];
    warning_messages?: BackendMessage[];
    payload_preview: Record<string, unknown>;
};

export type UploadRunResponse = {
    success: boolean;
    message: string;
    message_message?: BackendMessage | null;
};

export type RuntimeSettings = {
    auto_timing_v2_options?: import("./timingV2.js").TimingOptions;
    auto_roller_profile: "auto";
    auto_fill_lyrics_library_from_project_metadata: boolean;
    auto_cleanup_imported_lyrics: boolean;
    editor_show_metadata: boolean;
    editor_write_metadata_tags: boolean;
    upload_derive_plain_from_synced: boolean;

    auto_timing_hf_proxy: string;
    model_download_source: "modelscope" | "official";
    model_proxy_enabled: boolean;
    model_onboarding_complete: boolean;
    auto_timing_hf_etag_timeout?: number | null;
    auto_timing_hf_download_timeout?: number | null;

    recent_projects_limit: number;

    audio_filename_regex: string;
    audio_filename_regex_enabled: boolean;

    last_doctor_status?: string | null;
    last_doctor_at?: string | null;
    last_install_profile?: string | null;
    last_install_at?: string | null;
    last_install_status?: string | null;
};

export type AutoRollerRuntime = {
    startup_preparation?: boolean;
    preparation?: import("./runtimePreparation.js").Preparation;
    engine: string;
    mode: string;
    available: boolean;
    version?: string | null;
    cli_path?: string | null;
    python_executable: string;
    data_dir: string;
    model_store: string;
    settings: RuntimeSettings;
    detail?: string | null;
    detail_message?: BackendMessage | null;
    runtime_id?: string | null;
    runtime_status: string;
    runtime_profile?: string | null;
    runtime_root?: string | null;
    runtime_venv?: string | null;
    runtime_python?: string | null;
    runtime_source?: string | null;
    runtime_requirement?: string | null;
    doctor_report?: Record<string, unknown> | null;
    install_report?: Record<string, unknown> | null;
};
