import { backendMessageText } from "../../../shared/api/request.js";
import type { JobModel } from "../../../shared/api/types.js";
import { KeyValueList, LogBlock, MessageText } from "../../../ui/index.js";

type RuntimeStepStatus = "pending" | "running" | "done" | "failed";

type RuntimeStep = {
    key: string;
    label: string;
    status: RuntimeStepStatus;
    message: string;
};

const RUNTIME_INSTALL_KINDS = new Set(["auto-roller-runtime-install"]);
const RUNTIME_UPGRADE_KINDS = new Set(["auto-roller-runtime-upgrade"]);
const RUNTIME_CACHE_MODEL_KINDS = new Set(["auto-roller-runtime-cache-model"]);
const RUNTIME_DOCTOR_KINDS = new Set(["auto-roller-doctor"]);

function titleFromKey(key: string): string {
    return key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function eventText(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function jobStatusText(status: string, tr: Record<string, string>): string {
    return tr[status] || status;
}

function runtimeDuration(seconds: number | null, tr: Record<string, string>): string {
    if (seconds === null) return tr.unknown;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
        return tr.durationMinutesSeconds.replace("{m}", String(mins)).replace("{s}", String(secs));
    }
    return tr.durationSeconds.replace("{s}", String(secs));
}

function runtimeEvents(job: JobModel | null): Record<string, unknown>[] {
    return Array.isArray(job?.events) ? job!.events! : [];
}

function buildRuntimeSteps(job: JobModel | null): RuntimeStep[] {
    const events = runtimeEvents(job);
    const steps = new Map<string, RuntimeStep>();
    const ensure = (key: string): RuntimeStep => {
        const existing = steps.get(key);
        if (existing) return existing;
        const created = { key, label: titleFromKey(key), status: "pending" as RuntimeStepStatus, message: "" };
        steps.set(key, created);
        return created;
    };
    for (const event of events) {
        const type = eventText(event.type);
        let key = eventText(event.step);
        if (!key && type.startsWith("install_validation_")) key = "validation";
        if (!key && type.startsWith("install_doctor_")) key = "doctor";
        if (!key) continue;
        const step = ensure(key);
        if (type.endsWith("started")) step.status = "running";
        if (type.endsWith("completed")) step.status = "done";
        if (type.endsWith("failed")) step.status = "failed";
        const message = eventText(event.message) || eventText(event.line);
        if (message && type !== "install_subprocess_output") step.message = message;
        if (type === "install_validation_completed") {
            step.status = event.ok === false ? "failed" : "done";
            step.message = eventText(event.message);
        }
        if (type === "install_doctor_completed") {
            step.status = event.ok === false ? "failed" : "done";
        }
    }
    return Array.from(steps.values());
}

function doctorCheckSteps(job: JobModel | null): RuntimeStep[] {
    if (!job || !RUNTIME_DOCTOR_KINDS.has(job.kind)) return [];
    const report = job.result?.doctor_report;
    if (!report || typeof report !== "object" || !Array.isArray((report as { checks?: unknown }).checks)) return [];
    return (report as { checks: unknown[] }).checks.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object")
    ).map((check) => {
        const name = eventText(check.name) || "check";
        const statusText = eventText(check.status);
        return {
            key: name,
            label: titleFromKey(name),
            status: statusText === "fail" ? "failed" : "done",
            message: eventText(check.message),
        };
    });
}

function runtimeStepLabel(key: string, fallback: string, tr: Record<string, string>): string {
    const normalized = key.toLowerCase().replace(/-/g, "_");
    if (tr[key]) return tr[key];
    if (normalized.includes("packaging")) return tr.upgradePackaging;
    if (normalized.includes("torch") && (normalized.includes("remove") || normalized.includes("uninstall"))) {
        return tr.removeTorch;
    }
    if (normalized.includes("torch") && normalized.includes("install")) return tr.installTorch;
    if (normalized.includes("audio") && normalized.includes("install")) return tr.installAudio;
    if (normalized.includes("validat")) return tr.validate;
    if (normalized.includes("doctor")) return tr.doctor;
    return fallback;
}

function runtimeJobErrorText(error: string | null | undefined, tr: Record<string, string>): string {
    if (!error) return tr.taskFailed;
    const match = error.match(/^Command exited with code (\d+)/);
    if (match) return tr.commandExitedWithCode.replace("{code}", match[1]);
    return error;
}

function runtimeJobTitle(job: JobModel, labels: Record<string, string>): string {
    if (RUNTIME_INSTALL_KINDS.has(job.kind)) return labels.install || "Create / Repair Runtime";
    if (RUNTIME_UPGRADE_KINDS.has(job.kind)) return labels.upgrade || "Upgrade py-roller";
    if (RUNTIME_CACHE_MODEL_KINDS.has(job.kind)) return labels.cacheModel || "Pre-download Model";
    if (RUNTIME_DOCTOR_KINDS.has(job.kind)) return labels.doctor || "Runtime Check";
    return job.kind;
}

function doctorSummary(job: JobModel, msg: { doctorHealthy: string; doctorHealthyWithChecks: string }): string {
    const report = job.result?.doctor_report;
    if (!report || typeof report !== "object") return msg.doctorHealthy;
    const checks = (report as { checks?: unknown }).checks;
    if (!Array.isArray(checks)) return msg.doctorHealthy;
    return msg.doctorHealthyWithChecks.replace("{count}", String(checks.length));
}

function runtimeCompletionMessage(
    job: JobModel,
    msg: {
        taskComplete: string;
        runtimeReady: string;
        upgradedTo: string;
        upgraded: string;
        cacheModelDone: string;
        doctorHealthy: string;
        doctorHealthyWithChecks: string;
    },
    backendMessages: Record<string, string | undefined>,
): string {
    const result = job.result || {};
    if (RUNTIME_INSTALL_KINDS.has(job.kind) && typeof result.runtime_id === "string") {
        return msg.runtimeReady.replace("{id}", result.runtime_id);
    }
    if (RUNTIME_UPGRADE_KINDS.has(job.kind)) {
        if (typeof result.new_version === "string" && result.new_version) {
            return msg.upgradedTo.replace("{version}", result.new_version);
        }
        return msg.upgraded;
    }
    if (RUNTIME_CACHE_MODEL_KINDS.has(job.kind)) {
        return msg.cacheModelDone;
    }
    if (RUNTIME_DOCTOR_KINDS.has(job.kind)) return doctorSummary(job, msg);
    if (job.progress?.message_message) return backendMessageText(job.progress.message_message, backendMessages);
    return msg.taskComplete;
}

export const RuntimeJobTerminal: React.FC<{
    job: JobModel;
    elapsed: number | null;
    lastOutput: number | null;
    tr: Record<string, string>;
    jobLabels: Record<string, string>;
    jobMsg: {
        taskComplete: string;
        runtimeReady: string;
        upgradedTo: string;
        upgraded: string;
        cacheModelDone: string;
        doctorHealthy: string;
        doctorHealthyWithChecks: string;
    };
    backendMessages: Record<string, string | undefined>;
}> = ({ job, elapsed, lastOutput, tr, jobLabels, jobMsg, backendMessages }) => {
    const running = ["queued", "running"].includes(job.status);
    const steps = buildRuntimeSteps(job);
    const checks = doctorCheckSteps(job);
    const rawLog = job.logs.join("\n") || job.command.join(" ");
    const successMessage = job.status === "succeeded" ? runtimeCompletionMessage(job, jobMsg, backendMessages) : "";
    return (
        <div className="settings-job-terminal">
            <div className="settings-job-header">
                <div>
                    <b>{runtimeJobTitle(job, jobLabels)}</b>
                    <small>{job.job_id} · {jobStatusText(job.status, tr)}</small>
                </div>
                {job.status === "succeeded" && <span className="runtime-status-pill ok">{tr.succeeded}</span>}
                {job.status === "failed" && <span className="runtime-status-pill fail">{tr.failed}</span>}
                {running && <span className="runtime-status-pill running">{tr.running}</span>}
            </div>
            <KeyValueList compact>
                <b>{tr.pid}</b>
                <span>{job.pid || tr.pending}</span>
                <b>{tr.elapsed}</b>
                <span>{runtimeDuration(elapsed, tr)}</span>
                <b>{tr.lastOutput}</b>
                <span>{tr.ago.replace("{time}", runtimeDuration(lastOutput, tr))}</span>
                <b>{tr.exitCode}</b>
                <span>{job.return_code ?? tr.na}</span>
            </KeyValueList>
            {successMessage && (
                <MessageText type="success">{successMessage}</MessageText>
            )}
            {job.status === "failed" && (
                <MessageText type="error">
                    {job.error_message
                        ? backendMessageText(job.error_message, backendMessages)
                        : runtimeJobErrorText(job.error, tr)}
                </MessageText>
            )}
            {running && lastOutput !== null && lastOutput > 30 && <MessageText>{tr.noOutput}</MessageText>}
            {steps.length > 0 && (
                <ol className="runtime-step-list">
                    {steps.map((step) => (
                        <li key={step.key} className={`runtime-step ${step.status}`}>
                            <span className="runtime-step-dot" />
                            <span>
                                <b>{runtimeStepLabel(step.key, step.label, tr)}</b>
                                {step.message && <small>{step.message}</small>}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
            {checks.length > 0 && (
                <ol className="runtime-step-list">
                    {checks.map((step) => (
                        <li key={step.key} className={`runtime-step ${step.status}`}>
                            <span className="runtime-step-dot" />
                            <span>
                                <b>{runtimeStepLabel(step.key, step.label, tr)}</b>
                                {step.message && <small>{step.message}</small>}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
            <details className="runtime-raw-log">
                <summary>{tr.rawLog}</summary>
                <LogBlock>{rawLog}</LogBlock>
            </details>
        </div>
    );
};
