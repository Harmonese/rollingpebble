import { request } from "./request.js";

export type TimingLanguage = "auto" | "en" | "zh" | "zh-en" | "mul";
export type TimingOptions = {
    language: TimingLanguage;
    ctc_zh_model: string | null;
    ctc_mul_model: string | null;
    alignment_mode: "ordered" | "unordered";
    audio_mode: "mix" | "vocals";
    ctc_device: "auto" | "cpu" | "mps";
    cpu_threads: number;
    previews: boolean;
    offline: boolean;
    whisper_model: string | null;
    ctc_model: string | null;
};
export const defaultTimingOptions: TimingOptions = {
    language: "auto",
    ctc_zh_model: null,
    ctc_mul_model: null,
    alignment_mode: "ordered",
    audio_mode: "mix",
    ctc_device: "auto",
    cpu_threads: 4,
    previews: true,
    offline: true,
    whisper_model: null,
    ctc_model: null,
};
export type AlignmentLine = {
    input_line_index?: number;
    occurrence_id: string;
    line_id: string;
    text: string;
    start: number;
    end: number;
    status: "tentative" | "needs_review";
    finalized: boolean;
};
export type UnalignedLine = {
    occurrence_id: string;
    line_id: string;
    input_line_index: number;
    text: string;
    reason: string;
};
export type Snapshot = {
    language?: Exclude<TimingLanguage, "auto">;
    timing_backend?: string;
    revision: number;
    final: boolean;
    audio_available_until: number;
    lines: AlignmentLine[];
    alignment_mode?: "ordered" | "unordered";
    unaligned_lines?: UnalignedLine[];
};
export function reviewLines(snapshot: Snapshot): { text: string; time?: number }[] {
    if (snapshot.alignment_mode !== "ordered") {
        return snapshot.lines.map(line => ({ text: line.text, time: line.start }));
    }
    return [
        ...snapshot.lines.map(line => ({ text: line.text, time: line.start, index: line.input_line_index! })),
        ...(snapshot.unaligned_lines || []).map(line => ({ text: line.text, index: line.input_line_index })),
    ].sort((a, b) => a.index - b.index).map(({ index: _index, ...line }) => line);
}
export type DraftLine = { id: string; text: string; time: number | null };
export type Draft = { version: number; base_revision: number; lines: DraftLine[] | null };
export type RunStatus = "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
export type TimingRun = {
    language?: Exclude<TimingLanguage, "auto">;
    requested_language?: TimingLanguage;
    id: string;
    kind: "run" | "batch";
    project_id: string;
    status: RunStatus;
    created_at: string;
    updated_at: string;
    options: TimingOptions;
    workspace_id: string;
    lyrics_version: string;
    audio_identity: string;
    lyrics_hash?: string;
    snapshot: Snapshot | null;
    progress: { stage: string; duration?: number; audio_available_until?: number } | null;
    error: string | null;
    applied: { at: string; version: number }[];
    command?: string[];
    metrics?: Record<string, unknown>;
};
export type TimingBatch = TimingRun & { children: string[]; runs?: TimingRun[] };
export type RunInput = {
    project_id: string;
    options: TimingOptions;
    workspace_id?: string;
    lyrics_version?: string;
    audio_identity?: string;
    expected_lyrics?: string;
    expected_audio_ref?: string;
};
const base = "/api/auto-timing";
const post = <T>(url: string, body: unknown = {}) => request<T>(url, { method: "POST", body: JSON.stringify(body) });
export const isRunActive = (run: TimingRun | null) =>
    Boolean(run && ["queued", "running", "cancelling"].includes(run.status));
export const startTiming = (input: RunInput) => post<TimingRun>(`${base}/runs`, input);
export const retryTiming = (id: string, input: RunInput) => post<TimingRun>(`${base}/runs/${id}/retry`, input);
export const rememberTimingLanguage = (language: TimingLanguage) =>
    request("/api/settings", {
        method: "POST",
        body: JSON.stringify({ auto_timing_v2_options: { language } }),
    });
export const getTiming = (id: string) => request<TimingRun>(`${base}/runs/${id}`);
export const timingHistory = (projectId?: string) =>
    request<TimingRun[]>(`${base}/runs${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`);
export const cancelTiming = (id: string) => post<TimingRun>(`${base}/runs/${id}/cancel`);
export const getDraft = (id: string) => request<Draft>(`${base}/runs/${id}/draft`);
export const saveDraft = (id: string, draft: Draft) =>
    request<Draft>(`${base}/runs/${id}/draft`, { method: "PUT", body: JSON.stringify(draft) });
export const timingBinding = (id: string) => request<{ matches: boolean }>(`${base}/runs/${id}/binding`);
export const recordApplied = (id: string, version: number) =>
    post<TimingRun>(`${base}/runs/${id}/applied`, { version });
export const startBatch = (project_ids: string[], options: TimingOptions) =>
    post<TimingBatch>(`${base}/batches`, { project_ids, options });
export const getBatch = (id: string) => request<TimingBatch>(`${base}/batches/${id}`);
export const retryBatch = (id: string) => post<TimingBatch>(`${base}/batches/${id}/retry`);
export const resumeBatch = (id: string) => post<TimingBatch>(`${base}/batches/${id}/resume`);
export const TIMING_DELETED_EVENT = "rollingpebble:timing-deleted";
export const deleteTiming = async (id: string, kind: "run" | "batch" = "run") => {
    const result = await request<{ deleted: boolean; deleted_ids: string[] }>(
        `${base}/${kind === "batch" ? "batches" : "runs"}/${id}`,
        { method: "DELETE" },
    );
    for (const deletedId of result.deleted_ids) {
        window.dispatchEvent(new CustomEvent(TIMING_DELETED_EVENT, { detail: deletedId }));
    }
    return result;
};
export const timingDiagnostics = (id: string) =>
    request<{ path: string; stderr: string }>(`${base}/runs/${id}/diagnostics`);
