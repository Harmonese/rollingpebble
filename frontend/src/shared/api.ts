export type MetaModel = {
    track: string;
    artist: string;
    album: string;
    duration: number;
};

export type ProjectModel = {
    project_id: string;
    last_opened_at?: string | null;
    audio_name?: string | null;
    audio_ref?: string | null;
    audio_path?: string | null;
    metadata: MetaModel;
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

export type BackendMessage = {
    code: string;
    params?: Record<string, string | number | boolean | null>;
    fallback?: string;
};

export type JobModel = {
    job_id: string;
    kind: string;
    project_id?: string | null;
    status: "queued" | "running" | "succeeded" | "failed" | "canceled";
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

export type RollPreview = {
    command: string[];
    command_text: string;
    warnings: string[];
    warning_messages?: BackendMessage[];
    output_path?: string | null;
    intermediate_dir?: string | null;
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
    auto_roller_profile: "auto" | "cpu" | "cu124";
    auto_fill_lyrics_library_from_project_metadata: boolean;
    auto_cleanup_imported_lyrics: boolean;
    editor_show_metadata: boolean;
    editor_write_metadata_tags: boolean;
    upload_derive_plain_from_synced: boolean;

    auto_timing_default_language: "zh" | "en" | "mul";
    auto_timing_default_stages: string;
    auto_timing_default_writer_backend: string;
    auto_timing_default_writer_spacing: "keep" | "drop";
    auto_timing_default_cleanup: "on-success" | "never";
    auto_timing_default_log_level: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

    auto_timing_splitter_backend: string;
    auto_timing_splitter_demucs_model: string;
    auto_timing_splitter_demucs_device: string;
    auto_timing_splitter_demucs_jobs?: number | null;
    auto_timing_splitter_demucs_overlap?: number | null;
    auto_timing_splitter_demucs_segment?: number | null;

    auto_timing_filter_chain: string;

    auto_timing_transcriber_backend: string;
    auto_timing_transcriber_device: string;
    auto_timing_transcriber_model_name: string;
    auto_timing_model_store: string;
    auto_timing_transcriber_compute_type: string;
    auto_timing_transcriber_batch_size?: number | null;
    auto_timing_local_files_only_default: boolean;
    auto_timing_hf_xet: "auto" | "on" | "off";
    auto_timing_hf_proxy: string;
    auto_timing_hf_etag_timeout?: number | null;
    auto_timing_hf_download_timeout?: number | null;
    auto_timing_hf_max_workers?: number | null;

    auto_timing_parser_lyrics_encoding: string;

    auto_timing_aligner_backend: string;
    auto_timing_aligner_min_gap?: number | null;
    auto_timing_aligner_repetition: "none" | "few" | "full";

    auto_timing_writer_by_tag: string;
    auto_timing_writer_ass_karaoke_tag_type: "" | "k" | "K" | "kf" | "ko";

    recent_projects_limit: number;
    project_auto_delete_days: number;
    storage_projects_root: string;
    storage_models_root: string;
    storage_cache_root: string;
    storage_runtime_root: string;
    storage_work_root: string;

    audio_filename_regex: string;
    audio_filename_regex_enabled: boolean;

    last_doctor_status?: string | null;
    last_doctor_at?: string | null;
    last_install_profile?: string | null;
    last_install_at?: string | null;
    last_install_status?: string | null;
};


export type StorageModelItem = {
    id: string;
    label: string;
    provider: string;
    backend: string;
    model_name: string;
    relative_path: string;
    bytes: number;
    file_count: number;
    updated_at?: string | null;
    active: boolean;
};

export type StorageRuntimeItem = {
    runtime_id: string;
    profile: string;
    status: string;
    pyroller_version?: string | null;
    python_version?: string | null;
    relative_path: string;
    bytes: number;
    file_count: number;
    updated_at?: string | null;
    active: boolean;
    removable: boolean;
};

export type StorageOtherItem = {
    label: string;
    relative_path: string;
    bytes: number;
    file_count: number;
    updated_at?: string | null;
    removable: boolean;
};

export type StorageCategory = {
    id: string;
    label: string;
    bytes: number;
    file_count: number;
    path: string;
    description: string;
};

export type StorageRoot = {
    id: "projects" | "models" | "runtime" | "other";
    label: string;
    path: string;
    default_path: string;
    bytes: number;
    file_count: number;
    movable: boolean;
    active: boolean;
};

export type StorageProject = {
    project_id: string;
    title: string;
    artist: string;
    album: string;
    audio_name?: string | null;
    updated_at?: string | null;
    audio_bytes: number;
    lyrics_output_bytes: number;
    generated_bytes: number;
    intermediate_bytes: number;
    total_bytes: number;
    file_count: number;
    audio_file_count: number;
    lyrics_output_file_count: number;
    generated_file_count: number;
    intermediate_file_count: number;
    has_audio: boolean;
    has_lyrics_output: boolean;
    has_generated: boolean;
    has_intermediate: boolean;
    active: boolean;
};

export type StorageUsage = {
    data_dir: string;
    roots: StorageRoot[];
    total_bytes: number;
    file_count: number;
    categories: StorageCategory[];
    projects: StorageProject[];
    models: StorageModelItem[];
    runtimes: StorageRuntimeItem[];
    other_items: StorageOtherItem[];
};

export type StorageCleanupTarget =
    | "clean_models"
    | "delete_model_items"
    | "clean_runtime_envs"
    | "delete_projects"
    | "clear_intermediate"
    | "clean_project_generated"
    | "clean_external_cache"
    | "delete_other_items"
    | "delete_project_audio"
    | "delete_project_lyrics_output"
    | "safe";

export type StorageCleanupEntry = {
    id: string;
    category: string;
    label: string;
    relative_path: string;
    bytes: number;
    file_count: number;
    risk: "safe" | "caution" | "danger" | "blocked";
    reason: string;
    reason_message?: BackendMessage | null;
    removable: boolean;
};

export type StorageCleanupPlan = {
    plan_id: string;
    targets: string[];
    total_reclaimable_bytes: number;
    entry_count: number;
    entries: StorageCleanupEntry[];
    warnings: string[];
    warning_messages?: BackendMessage[];
};

export type StorageCleanupRunResult = {
    plan_id: string;
    deleted_bytes: number;
    deleted_count: number;
    skipped_count: number;
    failed: { entry_id: string; relative_path: string; error: string; error_message?: BackendMessage | null }[];
    usage?: StorageUsage | null;
};

export type StorageMigrateRootResult = {
    root: StorageRoot;
    old_path: string;
    backup_path?: string | null;
    moved_bytes: number;
    file_count: number;
    usage: StorageUsage;
};

export type AutoRollerRuntime = {
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

function parseResponseText(text: string): unknown {
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function extractErrorDetail(payload: unknown, fallback: string): string {
    if (!payload) {
        return fallback;
    }
    if (typeof payload === "string") {
        return payload || fallback;
    }
    if (typeof payload === "object" && "detail" in payload) {
        const detail = (payload as { detail?: unknown }).detail;
        if (typeof detail === "string") {
            return detail;
        }
        return JSON.stringify(detail);
    }
    return JSON.stringify(payload);
}

function isBackendMessage(value: unknown): value is BackendMessage {
    return Boolean(value && typeof value === "object" && "code" in value && typeof (value as { code?: unknown }).code === "string");
}

function extractBackendMessage(payload: unknown): BackendMessage | null {
    if (isBackendMessage(payload)) return payload;
    if (payload && typeof payload === "object" && "detail" in payload) {
        const detail = (payload as { detail?: unknown }).detail;
        return isBackendMessage(detail) ? detail : null;
    }
    return null;
}

function renderMessageTemplate(template: string, params?: BackendMessage["params"]): string {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
        const value = params?.[key];
        return value === undefined || value === null ? match : String(value);
    });
}

export class BackendApiError extends Error {
    backendMessage: BackendMessage | null;
    status: number;

    constructor(message: string, options: { backendMessage?: BackendMessage | null; status: number }) {
        super(message);
        this.name = "BackendApiError";
        this.backendMessage = options.backendMessage || null;
        this.status = options.status;
    }
}

export function backendMessageText(value: unknown, messages: Record<string, string | undefined>): string {
    const backendMessage = value instanceof BackendApiError
        ? value.backendMessage
        : isBackendMessage(value)
            ? value
            : null;
    if (backendMessage) {
        const template = messages[backendMessage.code];
        if (template) return renderMessageTemplate(template, backendMessage.params);
        if (backendMessage.fallback) return renderMessageTemplate(backendMessage.fallback, backendMessage.params);
        return backendMessage.code;
    }
    if (value instanceof Error) return value.message;
    if (typeof value === "string") return value;
    return String(value);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        headers: init?.body instanceof FormData
            ? init.headers
            : { "Content-Type": "application/json", ...init?.headers },
    });

    // A fetch response body can only be consumed once. Read it as text once,
    // then parse JSON from that string when possible. This avoids
    // "Failed to execute 'text' on 'Response': body stream already read"
    // when an error endpoint returns non-JSON or malformed JSON.
    const text = await response.text();
    const payload = parseResponseText(text);

    if (!response.ok) {
        const backendMessage = extractBackendMessage(payload);
        const message = backendMessage?.fallback || extractErrorDetail(payload, response.statusText);
        throw new BackendApiError(message, { backendMessage, status: response.status });
    }

    return payload as T;
}

export const api = {
    health: () => request<HealthResponse>("/api/health"),
    createProject: (audio: File) => {
        const form = new FormData();
        form.append("audio", audio);
        return request<ProjectModel>("/api/projects", { method: "POST", body: form });
    },
    listProjects: () => request<ProjectModel[]>("/api/projects"),
    getProject: (projectId: string) => request<ProjectModel>(`/api/projects/${projectId}`),
    deleteProject: (projectId: string) => request<{ deleted: string }>(`/api/projects/${projectId}`, { method: "DELETE" }),
    projectAudioUrl: (projectId: string) => `/api/projects/${projectId}/audio`,
    openProjectFolder: (projectId: string) =>
        request<{ status: string; path: string }>(`/api/projects/${projectId}/open-folder`, { method: "POST" }),
    openProjectsFolder: () =>
        request<{ status: string; path: string }>("/api/storage/projects/open-folder", { method: "POST" }),
    selectLocalPath: (payload: { mode?: "file" | "directory"; title?: string; initial_path?: string | null }) =>
        request<{ path: string; canceled: boolean }>("/api/local/select-path", { method: "POST", body: JSON.stringify(payload) }),
    applyLyrics: (projectId: string, payload: Partial<ProjectModel>) =>
        request<ProjectModel>(`/api/projects/${projectId}/lyrics`, { method: "POST", body: JSON.stringify(payload) }),
    saveEditor: (projectId: string, payload: { plain_lyrics: string; synced_lyrics: string; metadata: MetaModel }) =>
        request<ProjectModel>(`/api/projects/${projectId}/editor`, { method: "POST", body: JSON.stringify(payload) }),
    lrclibSearch: (payload: Record<string, unknown>) =>
        request<{ results: LyricsRecord[] }>("/api/lrclib/search", { method: "POST", body: JSON.stringify(payload) }),
    lrclibGet: (payload: MetaModel) =>
        request<{ record: LyricsRecord | null; duration_diff?: number | null; duration_ok: boolean; source: string }>(
            "/api/lrclib/get",
            { method: "POST", body: JSON.stringify(payload) },
        ),
    lrclibGetById: (lrclib_id: number) =>
        request<LyricsRecord | null>("/api/lrclib/id", { method: "POST", body: JSON.stringify({ lrclib_id }) }),
    neteaseSearch: (payload: { query?: string; track?: string; artist?: string; album?: string; limit?: number }) =>
        request<{ results: NeteaseSong[] }>("/api/netease/search", { method: "POST", body: JSON.stringify(payload) }),
    neteaseResolve: (value: string) =>
        request<{ song: NeteaseSong }>("/api/netease/resolve", { method: "POST", body: JSON.stringify({ value }) }),
    neteaseLyrics: (songId: number) =>
        request<NeteaseLyricResponse>(`/api/netease/lyrics/${songId}`),
    rollPreview: (projectId: string, payload: Record<string, unknown>) =>
        request<RollPreview>(`/api/projects/${projectId}/roll/preview`, { method: "POST", body: JSON.stringify(payload) }),
    roll: (projectId: string, payload: Record<string, unknown>) =>
        request<JobModel>(`/api/projects/${projectId}/roll`, { method: "POST", body: JSON.stringify(payload) }),
    batchPreview: (payload: Record<string, unknown>) =>
        request<{ project_count: number; projects: string[]; manifest: string; warnings: string[] }>("/api/batch/preview", { method: "POST", body: JSON.stringify(payload) }),
    batchRoll: (payload: Record<string, unknown>) =>
        request<JobModel>("/api/batch/roll", { method: "POST", body: JSON.stringify(payload) }),
    getJob: (jobId: string) => request<JobModel>(`/api/jobs/${jobId}`),
    cancelJob: (jobId: string) => request<JobModel>(`/api/jobs/${jobId}/cancel`, { method: "POST" }),
    openJobFolder: (jobId: string) =>
        request<{ status: string; path: string }>(`/api/jobs/${jobId}/open-folder`, { method: "POST" }),
    settings: () => request<RuntimeSettings>("/api/settings"),
    updateSettings: (payload: Partial<RuntimeSettings>) =>
        request<RuntimeSettings>("/api/settings", { method: "POST", body: JSON.stringify(payload) }),
    resetSettingsDefaults: () => request<RuntimeSettings>("/api/settings/reset-defaults", { method: "POST" }),
    uploadWorkspaceBg: (file: File) => {
        const form = new FormData();
        form.append("bg", file);
        return fetch("/api/settings/workspace-bg", { method: "POST", body: form });
    },
    deleteWorkspaceBg: () => request<{ ok: string }>("/api/settings/workspace-bg", { method: "DELETE" }),
    workspaceBgUrl: () => "/api/settings/workspace-bg",
    autoRollerRuntime: () => request<AutoRollerRuntime>("/api/runtime/auto-roller"),
    runAutoRollerDoctor: () => request<JobModel>("/api/runtime/auto-roller/doctor", { method: "POST" }),
    runAutoRollerInstall: (payload: { profile: "auto" | "cpu" | "cu124"; skip_doctor?: boolean; dry_run?: boolean }) =>
        request<JobModel>("/api/runtime/auto-roller/install", { method: "POST", body: JSON.stringify(payload) }),
    upgradeAutoRoller: (payload: { profile: "auto" | "cpu" | "cu124" }) =>
        request<JobModel>("/api/runtime/auto-roller/upgrade", { method: "POST", body: JSON.stringify(payload) }),
    cacheModel: (payload: { language: "zh" | "en" | "mul"; transcriber_backend?: string | null; transcriber_model_name?: string | null; transcriber_model_path?: string | null }) =>
        request<JobModel>("/api/runtime/auto-roller/cache-model", { method: "POST", body: JSON.stringify(payload) }),
    uploadPlan: (projectId: string, payload: Record<string, unknown>) =>
        request<UploadPlan>(`/api/projects/${projectId}/upload/plan`, { method: "POST", body: JSON.stringify(payload) }),
    uploadRun: (projectId: string, payload: Record<string, unknown>) =>
        request<UploadRunResponse>(`/api/projects/${projectId}/upload/run`, {
            method: "POST",
            body: JSON.stringify(payload),
        }),

    storageUsage: () => request<StorageUsage>("/api/storage/usage"),
    storageCleanupPreview: (payload: { targets: StorageCleanupTarget[]; older_than_days?: number | null; project_ids?: string[]; model_ids?: string[]; runtime_ids?: string[]; other_paths?: string[] }) =>
        request<StorageCleanupPlan>("/api/storage/cleanup/preview", { method: "POST", body: JSON.stringify(payload) }),
    openStorageFolder: () =>
        request<{ status: string; path: string }>("/api/storage/open-folder", { method: "POST" }),
    migrateStorageRoot: (payload: { root_id: "projects" | "models" | "cache"; target_path: string }) =>
        request<StorageMigrateRootResult>("/api/storage/migrate-root", { method: "POST", body: JSON.stringify(payload) }),
    openModelFolder: (modelId: string) =>
        request<{ status: string; path: string }>("/api/storage/models/open-folder", { method: "POST", body: JSON.stringify({ model_id: modelId }) }),
    openRuntimeFolder: (runtimeId: string) =>
        request<{ status: string; path: string }>("/api/storage/runtimes/open-folder", { method: "POST", body: JSON.stringify({ runtime_id: runtimeId }) }),
    openOtherFolder: (relativePath: string) =>
        request<{ status: string; path: string }>("/api/storage/other/open-folder", { method: "POST", body: JSON.stringify({ relative_path: relativePath }) }),
    storageCleanupRun: (payload: { plan_id: string; entry_ids?: string[] | null }) =>
        request<StorageCleanupRunResult>("/api/storage/cleanup/run", { method: "POST", body: JSON.stringify(payload) }),
};
