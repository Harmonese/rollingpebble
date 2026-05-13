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
    audio_path?: string | null;
    metadata: MetaModel;
    plain_lyrics: string;
    synced_lyrics: string;
    source: string;
    lrclib_id?: number | null;
};

export type LrcCleanseResponse = {
    status: string;
    cleaned_text?: string | null;
    plain_lyrics: string;
    is_instrumental: boolean;
    has_valid_timestamps: boolean;
    warnings: string[];
    reason?: string | null;
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
    status: "queued" | "running" | "succeeded" | "failed" | "canceled";
    command: string[];
    logs: string[];
    result?: Record<string, unknown> | null;
    error?: string | null;
    progress?: JobProgress | null;
    completed_stages: string[];
};

export type RollPreview = {
    command: string[];
    command_text: string;
    warnings: string[];
    output_path?: string | null;
    intermediate_dir?: string | null;
};

export type UploadPlan = {
    can_upload: boolean;
    mode: string;
    reason: string;
    plain_lines: number;
    synced_lines: number;
    warnings: string[];
    payload_preview: Record<string, unknown>;
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

    last_doctor_status?: string | null;
    last_doctor_at?: string | null;
    last_install_profile?: string | null;
    last_install_at?: string | null;
};

export type AutoRollerRuntime = {
    engine: string;
    available: boolean;
    version?: string | null;
    cli_path?: string | null;
    python_executable: string;
    data_dir: string;
    model_store: string;
    settings: RuntimeSettings;
    detail?: string | null;
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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        headers: init?.body instanceof FormData
            ? init.headers
            : { "Content-Type": "application/json", ...(init?.headers || {}) },
    });

    // A fetch response body can only be consumed once. Read it as text once,
    // then parse JSON from that string when possible. This avoids
    // "Failed to execute 'text' on 'Response': body stream already read"
    // when an error endpoint returns non-JSON or malformed JSON.
    const text = await response.text();
    const payload = parseResponseText(text);

    if (!response.ok) {
        throw new Error(extractErrorDetail(payload, response.statusText));
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
    projectAudioUrl: (projectId: string) => `/api/projects/${projectId}/audio`,
    openProjectFolder: (projectId: string) =>
        request<{ status: string; path: string }>(`/api/projects/${projectId}/open-folder`, { method: "POST" }),
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
    cleanLrc: (payload: { text: string; remove_translations?: boolean }) =>
        request<LrcCleanseResponse>("/api/lrc/cleanse", { method: "POST", body: JSON.stringify(payload) }),
    rollPreview: (projectId: string, payload: Record<string, unknown>) =>
        request<RollPreview>(`/api/projects/${projectId}/roll/preview`, { method: "POST", body: JSON.stringify(payload) }),
    roll: (projectId: string, payload: Record<string, unknown>) =>
        request<JobModel>(`/api/projects/${projectId}/roll`, { method: "POST", body: JSON.stringify(payload) }),
    getJob: (jobId: string) => request<JobModel>(`/api/jobs/${jobId}`),
    cancelJob: (jobId: string) => request<JobModel>(`/api/jobs/${jobId}/cancel`, { method: "POST" }),
    settings: () => request<RuntimeSettings>("/api/settings"),
    updateSettings: (payload: Partial<RuntimeSettings>) =>
        request<RuntimeSettings>("/api/settings", { method: "POST", body: JSON.stringify(payload) }),
    autoRollerRuntime: () => request<AutoRollerRuntime>("/api/runtime/auto-roller"),
    updateAutoRollerSettings: (payload: Partial<RuntimeSettings>) =>
        request<RuntimeSettings>("/api/runtime/auto-roller/settings", { method: "POST", body: JSON.stringify(payload) }),
    runAutoRollerDoctor: () => request<JobModel>("/api/runtime/auto-roller/doctor", { method: "POST" }),
    runAutoRollerInstall: (payload: { profile: "auto" | "cpu" | "cu124"; skip_doctor?: boolean; dry_run?: boolean }) =>
        request<JobModel>("/api/runtime/auto-roller/install", { method: "POST", body: JSON.stringify(payload) }),
    uploadPlan: (projectId: string, payload: Record<string, unknown>) =>
        request<UploadPlan>(`/api/projects/${projectId}/upload/plan`, { method: "POST", body: JSON.stringify(payload) }),
    uploadRun: (projectId: string, payload: Record<string, unknown>) =>
        request<{ success: boolean; message: string }>(`/api/projects/${projectId}/upload/run`, {
            method: "POST",
            body: JSON.stringify(payload),
        }),
};
