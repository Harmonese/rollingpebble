import { request } from "./request.js";
import type { AutoRollerRuntime, JobModel, RollPreview } from "./types.js";

export const rollPreview = (projectId: string, payload: Record<string, unknown>): Promise<RollPreview> =>
    request<RollPreview>(`/api/projects/${projectId}/roll/preview`, {
        method: "POST",
        body: JSON.stringify(payload),
    });

export const roll = (projectId: string, payload: Record<string, unknown>): Promise<JobModel> =>
    request<JobModel>(`/api/projects/${projectId}/roll`, { method: "POST", body: JSON.stringify(payload) });

export const batchPreview = (
    payload: Record<string, unknown>,
): Promise<{ project_count: number; projects: string[]; manifest: string; warnings: string[] }> =>
    request<{ project_count: number; projects: string[]; manifest: string; warnings: string[] }>(
        "/api/batch/preview",
        { method: "POST", body: JSON.stringify(payload) },
    );

export const batchRoll = (payload: Record<string, unknown>): Promise<JobModel> =>
    request<JobModel>("/api/batch/roll", { method: "POST", body: JSON.stringify(payload) });

export const autoRollerRuntime = (): Promise<AutoRollerRuntime> =>
    request<AutoRollerRuntime>("/api/runtime/auto-roller");

export const runAutoRollerDoctor = (): Promise<JobModel> =>
    request<JobModel>("/api/runtime/auto-roller/doctor", { method: "POST" });

export const runAutoRollerInstall = (
    payload: { profile: "auto" | "cpu" | "cu124"; skip_doctor?: boolean; dry_run?: boolean },
): Promise<JobModel> =>
    request<JobModel>("/api/runtime/auto-roller/install", { method: "POST", body: JSON.stringify(payload) });

export const upgradeAutoRoller = (payload: { profile: "auto" | "cpu" | "cu124" }): Promise<JobModel> =>
    request<JobModel>("/api/runtime/auto-roller/upgrade", { method: "POST", body: JSON.stringify(payload) });

export const cacheModel = (payload: {
    language: "zh" | "en" | "mul";
    transcriber_backend?: string | null;
    transcriber_model_name?: string | null;
    transcriber_model_path?: string | null;
    transcriber_hf_xet?: "auto" | "on" | "off" | null;
    transcriber_hf_proxy?: string | null;
    transcriber_hf_etag_timeout?: number | null;
    transcriber_hf_download_timeout?: number | null;
    transcriber_hf_max_workers?: number | null;
}): Promise<JobModel> =>
    request<JobModel>("/api/runtime/auto-roller/cache-model", { method: "POST", body: JSON.stringify(payload) });
