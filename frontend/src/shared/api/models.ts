import { cancelJob, getJob } from "./jobs.js";
import { request } from "./request.js";
import type { JobModel } from "./types.js";

export type ModelKind = "whisper" | "ctc" | "ctc-zh" | "ctc-mul" | "demucs";
export type ModelStatus = "missing" | "unverified" | "checking" | "ready" | "corrupt" | "downloading" | "failed";
export type ManagedModel = {
    kind: ModelKind;
    status: ModelStatus;
    available: boolean;
    path: string;
    checked_bytes: number;
    total_bytes: number;
    download_bytes: number;
    repair_needed: boolean;
    job_id: string | null;
    failure_phase?: string | null;
};
export type ModelIssue = {
    kind: ModelKind;
    origin: "managed" | "external";
    status: "missing" | "corrupt" | "failed" | "unverified";
    reason: string;
    action: "download" | "repair" | "verify" | "configure";
};
export type ModelsReport = {
    models: ManagedModel[];
    prepared_kinds: ModelKind[];
    job: JobModel | null;
    onboarding_complete: boolean;
    explicit: {
        whisper_model?: string | null;
        ctc_model?: string | null;
        ctc_zh_model?: string | null;
        ctc_mul_model?: string | null;
    };
    external_models: { kind: ModelKind; path: string; status: "available" | "unverified" | "missing" | "failed" }[];
    startup_issues: ModelIssue[];
};
export type ModelAction = "download" | "repair" | "verify" | "remove";
let cached: ModelsReport | null = null;
export const cachedModels = () => cached;
export const modelJobActive = (job?: JobModel | null) =>
    Boolean(job && ["queued", "running", "cancelling"].includes(job.status));
export const modelName = (kind: string, lang?: Language) => {
    if (kind === "whisper") return "Whisper large-v3";
    if (kind === "ctc") return lang?.timingV2.ctcEnglish || "CTC · English";
    if (kind === "ctc-zh") return lang?.timingV2.ctcMandarin || "CTC · Mandarin";
    if (kind === "ctc-mul") return lang?.timingV2.ctcMultilingual || "CTC · Multilingual";
    return "Demucs";
};
export async function getModels() {
    cached = await request<ModelsReport>("/api/auto-timing/models");
    return cached;
}
export const manageModels = (action: ModelAction, kinds?: ModelKind[], startup = false) =>
    request<JobModel>("/api/auto-timing/models", {
        method: "POST",
        body: JSON.stringify({ action, kinds, startup }),
    });
export async function waitForModels(job: JobModel, current: () => boolean, progress: (job: JobModel) => void) {
    let next = job;
    while (current()) {
        progress(next);
        if (!modelJobActive(next)) return next;
        await new Promise(resolve => setTimeout(resolve, 350));
        if (!current()) return null;
        next = await getJob(next.job_id);
    }
    return null;
}
export async function cancelModels(job: JobModel) {
    const next = await cancelJob(job.job_id);
    return waitForModels(next, () => true, () => {});
}
