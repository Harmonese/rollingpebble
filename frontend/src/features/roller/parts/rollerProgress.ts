import { backendMessageText } from "../../../shared/api/request.js";
import type { JobModel } from "../../../shared/api/types.js";
import { formatBytes } from "../../../shared/format.js";

export function formatCommandPreview(commandText: string | null | undefined, placeholder: string): string {
    if (!commandText) return placeholder;
    return commandText.replace(/\s--/g, " \\\n  --");
}

export function normalizeProgressStage(stage: string): string {
    const normalized = (stage || "").replace(/-/g, "_");
    if (normalized === "transcriber_preflight") return "preflight";
    if (normalized === "model_download") return "model_download";
    return normalized;
}

export function progressStageLabel(
    stage: string,
    labels: Record<string, string>,
    fallbacks: { preparing: string; complete: string },
): string {
    const normalizedStage = normalizeProgressStage(stage);
    if (!normalizedStage) return fallbacks.preparing;
    if (labels[normalizedStage]) return labels[normalizedStage];
    if (normalizedStage === "complete") return fallbacks.complete;
    return normalizedStage
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

export function progressMessage(
    progress: JobModel["progress"],
    msg: {
        waiting: string;
        working: string;
        segmentsUnit: string;
        complete: string;
        stageLabels: Record<string, string>;
        modelSource: string;
        localCacheOnly: string;
        modelDownloadChecking: string;
        modelCacheReady: string;
        modelCacheDownloading: string;
        backendMessages: Record<string, string | undefined>;
    },
): string {
    if (!progress) return msg.waiting;
    if (progress.message_message) return backendMessageText(progress.message_message, msg.backendMessages);
    const normalizedStage = normalizeProgressStage(progress.stage || "");
    if (progress.bytes_downloaded != null || progress.bytes_total != null) {
        const pieces = [`${formatBytes(progress.bytes_downloaded)} / ${formatBytes(progress.bytes_total)}`];
        if (progress.bytes_per_second != null) pieces.push(`${formatBytes(progress.bytes_per_second)}/s`);
        if (progress.repo_id) pieces.push(progress.repo_id);
        return pieces.join(" · ");
    }
    if (normalizedStage === "model_download") {
        const message = progress.message || "";
        if (message.startsWith("model source: ")) {
            return `${msg.modelSource}: ${message.slice("model source: ".length)}`;
        }
        if (message === "using local cache only") return msg.localCacheOnly;
        if (message.startsWith("checking/downloading model cache")) return msg.modelDownloadChecking;
        const repo = progress.repo_id || message.replace(/^Downloading model cache for /, "").replace(/^Model cache ready for /, "");
        if (message.startsWith("Downloading model cache for ")) return msg.modelCacheDownloading.replace("{repo}", repo);
        if (message.startsWith("Model cache ready for ")) return msg.modelCacheReady.replace("{repo}", repo);
        if (progress.done) return `${msg.stageLabels.model_download || msg.working} · ${msg.complete}`;
        return msg.stageLabels.model_download || msg.working;
    }
    if (normalizedStage === "transcriber" && progress.message) {
        const detail = progress.detail || {};
        const audioTime = typeof detail.audio_time_processed === "number" ? detail.audio_time_processed : null;
        const duration = typeof detail.audio_duration === "number" ? detail.audio_duration : null;
        const segments = typeof detail.segments === "number" ? detail.segments : null;
        const parts = [msg.stageLabels.transcriber || progress.message];
        if (audioTime != null && duration) parts.push(`${audioTime.toFixed(1)}s / ${duration.toFixed(1)}s`);
        if (segments != null) parts.push(msg.segmentsUnit.replace("{n}", String(segments)));
        return parts.join(" · ");
    }
    if (progress.done && msg.stageLabels[normalizedStage]) return `${msg.stageLabels[normalizedStage]} · ${msg.complete}`;
    return msg.stageLabels[normalizedStage] || progress.message || msg.working;
}

export function unitLabel(
    unit: string,
    labels: { phase: string; step: string; task: string; percent: string },
): string {
    if (unit === "%") return labels.percent;
    if (unit === "phase") return labels.phase;
    if (unit === "step") return labels.step;
    if (unit === "task") return labels.task;
    return unit;
}

export function runtimeMessage(text: string, u: { autoTimingRuntimeNotReady: string }): string {
    if (
        text
            === "Auto Timing runtime is not ready. Create or repair the isolated runtime in Settings before running py-roller."
    ) {
        return u.autoTimingRuntimeNotReady || text;
    }
    return text;
}

export function jobStatusLabel(
    status: string | undefined,
    u: {
        statusQueued: string;
        statusRunning: string;
        statusSucceeded: string;
        statusFailed: string;
        statusCanceled: string;
    },
): string {
    if (!status) return "";
    const labels: Record<string, string> = {
        queued: u.statusQueued,
        running: u.statusRunning,
        succeeded: u.statusSucceeded,
        failed: u.statusFailed,
        canceled: u.statusCanceled,
    };
    return labels[status] || status;
}

export function buildStageSequence(labels: Record<string, string>) {
    return [
        { key: "preflight", label: labels.preflight },
        { key: "model_download", label: labels.model_download },
        { key: "splitter", label: labels.splitter },
        { key: "filter", label: labels.filter },
        { key: "transcriber", label: labels.transcriber },
        { key: "parser", label: labels.parser },
        { key: "aligner", label: labels.aligner },
        { key: "writer", label: labels.writer },
    ];
}

export function stageStatus(
    stage: string,
    currentStage: string,
    sequence: { key: string; label: string }[],
    jobStatus?: string,
    completedStages: string[] = [],
): "done" | "active" | "idle" | "failed" {
    const normalizedCurrent = normalizeProgressStage(currentStage);
    const normalizedCompleted = completedStages.map(normalizeProgressStage);
    if (normalizedCompleted.includes(stage)) return "done";
    const currentIndex = sequence.findIndex((item) => item.key === normalizedCurrent);
    const index = sequence.findIndex((item) => item.key === stage);
    if (normalizedCurrent === stage) return jobStatus === "failed" ? "failed" : "active";
    if (currentIndex >= 0 && index >= 0 && index < currentIndex) return "done";
    if (jobStatus === "succeeded") return "done";
    return "idle";
}
