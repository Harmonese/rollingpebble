import { useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { appContext, ChangBits } from "../../components/app.context.js";
import { ModalShell } from "../../components/ModalShell.js";
import { PanelMessage } from "../../components/PanelMessage.js";
import { SettingsActionRow, SettingsCheckRow } from "../../components/SettingsRows.js";
import { toastPubSub } from "../../components/toast.js";
import { useAutoTimingState } from "../../hooks/useAutoTimingState.js";
import { useMessage } from "../../hooks/useMessage.js";
import { themeColor as themeColors, ThemeMode } from "../../hooks/usePref.js";
import {
    api,
    type AutoRollerRuntime,
    backendMessageText,
    type JobModel,
    type StorageCleanupTarget,
    type StorageRoot,
    type StorageUsage,
} from "../../shared/api.js";
import { formatBytes, secondsSince } from "../../shared/format.js";
import { INTEGER_POSITIVE_ERROR, NUMERIC_POSITIVE_ERROR } from "../../shared/numbers.js";
import { notifySettingsUpdated } from "../../shared/settingsEvents.js";
import { AutoTimingFields } from "../roller/AutoTimingFields.js";
import { ColorPicker } from "./ColorPicker.js";

type Profile = "auto" | "cpu" | "cu124";
function isOlderThanDays(value: string | null | undefined, days: number): boolean {
    if (days <= 0) return true;
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    return Date.now() - date.getTime() >= days * 86400 * 1000;
}

type RuntimeStepStatus = "pending" | "running" | "done" | "failed";

type RuntimeStep = {
    key: string;
    label: string;
    status: RuntimeStepStatus;
    message: string;
};

function titleFromKey(key: string): string {
    return key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function jobStatusText(status: string, tr: Record<string, string>): string {
    return tr[status] || status;
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

function settingsErrorText(
    error: unknown,
    messages: { numericPositive: string; integerPositive: string },
    backendMessages: Record<string, string | undefined>,
): string {
    const message = (error as Error).message;
    if (message === NUMERIC_POSITIVE_ERROR) return messages.numericPositive;
    if (message === INTEGER_POSITIVE_ERROR) return messages.integerPositive;
    return backendMessageText(error, backendMessages);
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

function eventText(value: unknown): string {
    return typeof value === "string" ? value : "";
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
    if (!job || job.kind !== "auto-roller-doctor") return [];
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

function runtimeJobTitle(job: JobModel, labels: Record<string, string>): string {
    if (job.kind === "auto-roller-runtime-install") return labels.install || "Create / Repair Runtime";
    if (job.kind === "auto-roller-runtime-upgrade") return labels.upgrade || "Upgrade py-roller";
    if (job.kind === "auto-roller-runtime-cache-model") return labels.cacheModel || "Pre-download Model";
    if (job.kind === "auto-roller-doctor") return labels.doctor || "Runtime Check";
    return job.kind;
}

function runtimeCompletionMessage(
    job: JobModel,
    msg: { taskComplete: string; runtimeReady: string; upgradedTo: string; upgraded: string; cacheModelDone: string },
): string {
    const result = job.result || {};
    if (job.kind === "auto-roller-runtime-install" && typeof result.runtime_id === "string") {
        return msg.runtimeReady.replace("{id}", result.runtime_id);
    }
    if (job.kind === "auto-roller-runtime-upgrade") {
        if (typeof result.new_version === "string" && result.new_version) {
            return msg.upgradedTo.replace("{version}", result.new_version);
        }
        return msg.upgraded;
    }
    if (job.kind === "auto-roller-runtime-cache-model") {
        return msg.cacheModelDone;
    }
    if (job.kind === "auto-roller-doctor") return "";
    return job.progress?.message || msg.taskComplete;
}

const RuntimeJobTerminal: React.FC<
    {
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
        };
        backendMessages: Record<string, string | undefined>;
    }
> = ({ job, elapsed, lastOutput, tr, jobLabels, jobMsg, backendMessages }) => {
    const running = ["queued", "running"].includes(job.status);
    const steps = buildRuntimeSteps(job);
    const checks = doctorCheckSteps(job);
    const rawLog = job.logs.join("\n") || job.command.join(" ");
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
            <div className="roller-kv compact">
                <b>{tr.pid}</b>
                <span>{job.pid || tr.pending}</span>
                <b>{tr.elapsed}</b>
                <span>{runtimeDuration(elapsed, tr)}</span>
                <b>{tr.lastOutput}</b>
                <span>{tr.ago.replace("{time}", runtimeDuration(lastOutput, tr))}</span>
                <b>{tr.exitCode}</b>
                <span>{job.return_code ?? tr.na}</span>
            </div>
            {job.status === "succeeded" && runtimeCompletionMessage(job, jobMsg) && (
                <p className="roller-message success">{runtimeCompletionMessage(job, jobMsg)}</p>
            )}
            {job.status === "failed" && (
                <p className="roller-message error">
                    {job.error_message
                        ? backendMessageText(job.error_message, backendMessages)
                        : runtimeJobErrorText(job.error, tr)}
                </p>
            )}
            {running && lastOutput !== null && lastOutput > 30 && <p className="roller-message subtle">{tr.noOutput}
            </p>}
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
                <pre className="roller-log">{rawLog}</pre>
            </details>
        </div>
    );
};

const SpaceStepper: React.FC<{
    label: string;
    value: number;
    onChange: (value: number) => void;
}> = ({ label, value, onChange }) => {
    const labelId = useId();
    const setSafeValue = (next: number) => onChange(Math.max(0, Number.isFinite(next) ? Math.round(next) : 0));
    return (
        <div className="space-stepper-field">
            <span id={labelId}>{label}</span>
            <div className="space-stepper" role="group" aria-labelledby={labelId}>
                <button
                    type="button"
                    className="space-stepper-btn"
                    aria-label={`${label} -`}
                    disabled={value <= 0}
                    onClick={() => setSafeValue(value - 1)}
                >
                    -
                </button>
                <input
                    inputMode="numeric"
                    aria-labelledby={labelId}
                    value={value}
                    onChange={(ev) => setSafeValue(Number(ev.currentTarget.value))}
                />
                <button
                    type="button"
                    className="space-stepper-btn"
                    aria-label={`${label} +`}
                    onClick={() => setSafeValue(value + 1)}
                >
                    +
                </button>
            </div>
        </div>
    );
};

export const SettingsPanel: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const [runtime, setRuntime] = useState<AutoRollerRuntime | null>(null);
    const [profile, setProfile] = useState<Profile>("auto");
    const [autoFillLibrary, setAutoFillLibrary] = useState(true);
    const [editorWriteMetadataTags, setEditorWriteMetadataTags] = useState(true);
    const bgInputRef = useRef<HTMLInputElement>(null);
    const [uploadDerivePlain, setUploadDerivePlain] = useState(true);
    const [audioRegexEnabled, setAudioRegexEnabled] = useState(false);
    const [audioRegex, setAudioRegex] = useState("");
    const [hexInput, setHexInput] = useState("");
    const [recentProjectsLimit, setRecentProjectsLimit] = useState("8");
    const [projectAutoDeleteDays, setProjectAutoDeleteDays] = useState("0");
    const [autoTimingLoaded, setAutoTimingLoaded] = useState(false);
    const skipAutoTimingSave = useRef(true);
    const autoTimingSaveTimer = useRef<number | null>(null);

    const at = useAutoTimingState();

    const [job, setJob] = useState<JobModel | null>(null);
    const { prefState, prefDispatch, lang } = useContext(appContext, ChangBits.prefState | ChangBits.lang);
    const t = lang.settings;

    useEffect(() => {
        setHexInput(prefState.themeColor);
    }, [prefState.themeColor]);
    const u = lang.ui;
    const trOpt = (key: string) => (lang.optionLabels as Record<string, string | undefined>)?.[key] || key;
    const tl = (key: string): string => {
        const storageLabels = lang.storageLabels as Record<string, string | undefined>;
        const storageReasons = lang.storageReasons as Record<string, string | undefined>;
        if (key.startsWith("storage_label.")) return storageLabels?.[key.slice(14)] || key;
        if (key.startsWith("storage_reason.")) return storageReasons?.[key.slice(15)] || key;
        return storageLabels?.[key] || key;
    };
    const [message, setMessage, , messageFading, messageType, messageKey] = useMessage();
    const [runtimeError, setRuntimeError] = useState("");
    const [busy, setBusy] = useState(false);

    const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
    const [storageOlderThanDays, setStorageOlderThanDays] = useState("1");
    const [storageBusy, setStorageBusy] = useState(false);
    const [storageTargetPaths, setStorageTargetPaths] = useState<Record<string, string>>({});

    const refresh = useCallback(async (notify = false) => {
        try {
            setAutoTimingLoaded(false);
            const data = await api.autoRollerRuntime();
            const settings = data.settings;
            setRuntime(data);
            setProfile(settings.auto_roller_profile);
            setAutoFillLibrary(settings.auto_fill_lyrics_library_from_project_metadata);
            setEditorWriteMetadataTags(settings.editor_write_metadata_tags);
            setUploadDerivePlain(settings.upload_derive_plain_from_synced);
            setAudioRegexEnabled(settings.audio_filename_regex_enabled || false);
            setAudioRegex(settings.audio_filename_regex || "");
            setRecentProjectsLimit(String(settings.recent_projects_limit || 8));
            setProjectAutoDeleteDays(String(settings.project_auto_delete_days || 0));
            at.loadFromSettings(settings);
            skipAutoTimingSave.current = true;
            window.setTimeout(() => setAutoTimingLoaded(true), 0);
            if (notify) toastPubSub.pub({ type: "success", text: t.messages.statusRefreshed });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        }
    }, []);

    const refreshStorage = useCallback(async () => {
        try {
            const usage = await api.storageUsage();
            setStorageUsage(usage);
            setStorageTargetPaths((current) => {
                const next = { ...current };
                usage.roots.forEach((root) => {
                    if (!(root.id in next)) next[root.id] = root.path;
                });
                return next;
            });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        }
    }, []);

    useEffect(() => {
        if (open) {
            void refresh();
            void refreshStorage();
        }
    }, [open, refresh, refreshStorage]);

    useEffect(() => {
        if (!job || !["queued", "running"].includes(job.status)) return;
        const timer = window.setInterval(async () => {
            try {
                const next = await api.getJob(job.job_id);
                setJob(next);
                if (["succeeded", "failed", "canceled"].includes(next.status)) {
                    void refresh();
                }
            } catch (error) {
                setMessage(backendMessageText(error, lang.backendMessages), "error");
            }
        }, 1400);
        return () => window.clearInterval(timer);
    }, [job, refresh]);

    const runtimeJobRunning = Boolean(job && ["queued", "running"].includes(job.status));
    const runtimeJobElapsed = secondsSince(job?.started_at);
    const runtimeJobLastOutput = secondsSince(job?.last_output_at || job?.started_at);

    const savePatch = async (payload: Record<string, unknown>, success?: string) => {
        setBusy(true);
        setMessage(t.messages.saving, "info");
        try {
            await api.updateSettings(payload);
            notifySettingsUpdated();
            await refresh();
            setMessage("");
            toastPubSub.pub({ type: "success", text: success || t.messages.saved });
        } catch (error) {
            setMessage(settingsErrorText(error, t.messages, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    const saveProfile = async (value: Profile) => {
        setProfile(value);
        await savePatch({ auto_roller_profile: value });
    };

    const resetDefaults = async () => {
        if (!window.confirm(u.resetConfirm)) return;
        setBusy(true);
        setMessage(t.messages.resetting, "info");
        try {
            await api.resetSettingsDefaults();
            notifySettingsUpdated();
            await refresh();
            setMessage("");
            toastPubSub.pub({ type: "success", text: t.messages.resetDone });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    const saveAutoTimingDefaults = useCallback(async () => {
        try {
            await api.updateSettings(at.buildSettingsPayload());
            notifySettingsUpdated();
            toastPubSub.pub({ type: "success", text: t.messages.autoTimingSaved });
        } catch (error) {
            setMessage(settingsErrorText(error, t.messages, lang.backendMessages), "error");
        }
    }, [at.buildSettingsPayload]);

    useEffect(() => {
        if (!open || !autoTimingLoaded) return;
        if (skipAutoTimingSave.current) {
            skipAutoTimingSave.current = false;
            return;
        }
        if (autoTimingSaveTimer.current !== null) {
            window.clearTimeout(autoTimingSaveTimer.current);
        }
        autoTimingSaveTimer.current = window.setTimeout(() => {
            void saveAutoTimingDefaults();
        }, 650);
        return () => {
            if (autoTimingSaveTimer.current !== null) {
                window.clearTimeout(autoTimingSaveTimer.current);
                autoTimingSaveTimer.current = null;
            }
        };
    }, [autoTimingLoaded, open, saveAutoTimingDefaults]);

    const onBgUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try {
            await api.uploadWorkspaceBg(file);
            window.dispatchEvent(new Event("rollingpebble:workspace-bg-changed"));
            toastPubSub.pub({ type: "success", text: t.messages.bgUpdated });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    const resetBg = async () => {
        setBusy(true);
        try {
            await api.deleteWorkspaceBg();
            window.dispatchEvent(new Event("rollingpebble:workspace-bg-changed"));
            toastPubSub.pub({ type: "success", text: t.messages.bgReset });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    const openStorageFolder = async () => {
        setStorageBusy(true);
        try {
            const result = await api.openStorageFolder();
            toastPubSub.pub({ type: "success", text: t.messages.openedFolder.replace("{path}", result.path) });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const browseStorageRoot = async (root: StorageRoot) => {
        if (!root.movable) return;
        setStorageBusy(true);
        try {
            const result = await api.selectLocalPath({
                mode: "directory",
                title: t.storage.selectStorageLocation.replace("{label}", tl(root.label)),
                initial_path: storageTargetPaths[root.id] || root.path || null,
            });
            if (!result.canceled && result.path) {
                setStorageTargetPaths((current) => ({ ...current, [root.id]: result.path }));
            }
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const migrateStorageRoot = async (root: StorageRoot) => {
        if (!root.movable || !["projects", "models"].includes(root.id)) return;
        const targetPath = (storageTargetPaths[root.id] || "").trim();
        if (!targetPath || targetPath === root.path) {
            setMessage(t.storage.targetUnchanged, "warning");
            return;
        }
        if (
            !window.confirm(
                t.storage.confirmMigrateRoot.replace("{label}", tl(root.label)).replace("{path}", targetPath),
            )
        ) return;
        setStorageBusy(true);
        setMessage(t.storage.migrating, "info");
        try {
            const result = await api.migrateStorageRoot({
                root_id: root.id as "projects" | "models",
                target_path: targetPath,
            });
            setStorageUsage(result.usage);
            setStorageTargetPaths((current) => ({ ...current, [root.id]: result.root.path }));
            setMessage("");
            toastPubSub.pub({
                type: "success",
                text: t.storage.migratedRoot.replace("{label}", tl(result.root.label)).replace(
                    "{bytes}",
                    formatBytes(result.moved_bytes),
                ),
            });
            void refresh();
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const openModelFolder = async (modelId: string) => {
        setStorageBusy(true);
        try {
            const result = await api.openModelFolder(modelId);
            toastPubSub.pub({ type: "success", text: t.messages.openedFolder.replace("{path}", result.path) });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const openRuntimeFolder = async (runtimeId: string) => {
        setStorageBusy(true);
        try {
            const result = await api.openRuntimeFolder(runtimeId);
            toastPubSub.pub({ type: "success", text: t.messages.openedFolder.replace("{path}", result.path) });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const openOtherFolder = async (relativePath: string) => {
        setStorageBusy(true);
        try {
            const result = await api.openOtherFolder(relativePath);
            toastPubSub.pub({ type: "success", text: t.messages.openedFolder.replace("{path}", result.path) });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const runDoctor = async () => {
        setBusy(true);
        setRuntimeError("");
        try {
            const created = await api.runAutoRollerDoctor();
            setJob(created);
            toastPubSub.pub({ type: "success", text: t.messages.runtimeJobStarted.replace("{id}", created.job_id) });
        } catch (error) {
            setRuntimeError(backendMessageText(error, lang.backendMessages));
        } finally {
            setBusy(false);
        }
    };

    const runInstall = async () => {
        setBusy(true);
        setRuntimeError("");
        try {
            const created = await api.runAutoRollerInstall({ profile });
            setJob(created);
            toastPubSub.pub({ type: "success", text: t.messages.runtimeJobStarted.replace("{id}", created.job_id) });
        } catch (error) {
            setRuntimeError(backendMessageText(error, lang.backendMessages));
        } finally {
            setBusy(false);
        }
    };

    const copyDiagnostics = async () => {
        const text = JSON.stringify(
            {
                runtime,
                doctor_report: runtime?.doctor_report || job?.result?.doctor_report || null,
                install_report: runtime?.install_report || job?.result?.install_report || null,
                job,
            },
            null,
            2,
        );
        try {
            await navigator.clipboard?.writeText(text);
            toastPubSub.pub({ type: "success", text: t.messages.diagnosticsCopied });
        } catch (error) {
            toastPubSub.pub({ type: "error", text: backendMessageText(error, lang.backendMessages) });
        }
    };

    const runUpgrade = async () => {
        setBusy(true);
        setRuntimeError("");
        try {
            const created = await api.upgradeAutoRoller({ profile });
            setJob(created);
            toastPubSub.pub({ type: "success", text: t.messages.runtimeJobStarted.replace("{id}", created.job_id) });
        } catch (error) {
            setRuntimeError(backendMessageText(error, lang.backendMessages));
        } finally {
            setBusy(false);
        }
    };

    const runCacheModel = async () => {
        setBusy(true);
        setRuntimeError("");
        try {
            const created = await api.cacheModel({
                language: at.language,
                transcriber_backend: at.transcriberBackend || null,
                transcriber_model_name: at.transcriberModel || null,
                transcriber_model_path: null,
            });
            setJob(created);
            toastPubSub.pub({ type: "success", text: t.messages.runtimeJobStarted.replace("{id}", created.job_id) });
        } catch (error) {
            setRuntimeError(backendMessageText(error, lang.backendMessages));
        } finally {
            setBusy(false);
        }
    };

    const cancelRuntimeJob = async () => {
        if (!job || !runtimeJobRunning) return;
        setBusy(true);
        setRuntimeError("");
        try {
            const canceled = await api.cancelJob(job.job_id);
            setJob(canceled);
        } catch (error) {
            setRuntimeError(backendMessageText(error, lang.backendMessages));
        } finally {
            setBusy(false);
        }
    };

    const runStorageCleanupDirect = async (
        targets: StorageCleanupTarget[],
        options: {
            projectIds?: string[];
            modelIds?: string[];
            runtimeIds?: string[];
            otherPaths?: string[];
            confirmation?: string;
        } = {},
    ) => {
        const projectIds = options.projectIds || [];
        const modelIds = options.modelIds || [];
        const runtimeIds = options.runtimeIds || [];
        const otherPaths = options.otherPaths || [];
        if (
            projectIds.length === 0
            && targets.some((target) => target === "delete_projects" || target === "clear_intermediate")
        ) {
            setMessage(t.messages.noProjectsClean, "warning");
            return;
        }
        if (modelIds.length === 0 && targets.includes("delete_model_items")) {
            setMessage(t.messages.noModelsClean, "warning");
            return;
        }
        if (runtimeIds.length === 0 && targets.includes("clean_runtime_envs")) {
            setMessage(t.messages.noRuntimesDelete, "warning");
            return;
        }
        if (otherPaths.length === 0 && targets.includes("delete_other_items")) {
            setMessage(t.messages.noOtherDelete, "warning");
            return;
        }
        if (options.confirmation && !window.confirm(options.confirmation)) {
            return;
        }
        setStorageBusy(true);
        setMessage("");
        setMessage(t.messages.cleaning, "info");
        try {
            const plan = await api.storageCleanupPreview({
                targets,
                project_ids: projectIds,
                model_ids: modelIds,
                runtime_ids: runtimeIds,
                other_paths: otherPaths,
                older_than_days: 0,
            });
            const result = await api.storageCleanupRun({
                plan_id: plan.plan_id,
                entry_ids: null,
            });
            if (result.usage) setStorageUsage(result.usage);
            const failedText = result.failed.length
                ? ` ${t.messages.failedEntries.replace("{count}", String(result.failed.length))}`
                : "";
            setMessage("");
            toastPubSub.pub({
                type: "success",
                text: t.messages.deletedEntries.replace("{count}", String(result.deleted_count)).replace(
                    "{bytes}",
                    formatBytes(result.deleted_bytes),
                ) + failedText,
            });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const clearBrowserState = async () => {
        if (!window.confirm(u.clearBrowserConfirm)) return;
        setStorageBusy(true);
        try {
            const localKeys = [
                "rollingpebble-hidden-recent-projects",
                "lrc-maker-lyric",
                "lrc-maker-oauth-token",
                "lrc-maker-gist-id",
                "lrc-maker-gist-etag",
                "lrc-maker-gist-file",
            ];
            const sessionKeys = ["audio-src", "editor-details-open", "sync-mode", "select-index", "x-ratelimit"];
            localKeys.forEach((key) => localStorage.removeItem(key));
            sessionKeys.forEach((key) => sessionStorage.removeItem(key));
            if ("caches" in window) {
                const names = await caches.keys();
                await Promise.all(
                    names.filter((name) => name.startsWith("rollingpebble")).map((name) => caches.delete(name)),
                );
            }
            toastPubSub.pub({ type: "success", text: t.messages.browserCleared });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const projectOlderThanDays = Number.isFinite(Number(storageOlderThanDays))
        ? Math.max(0, Math.round(Number(storageOlderThanDays)))
        : 0;
    const normalizedAutoDeleteDays = Number.isFinite(Number(projectAutoDeleteDays))
        ? Math.max(0, Math.round(Number(projectAutoDeleteDays)))
        : 0;
    const storageProjects = (storageUsage?.projects || []).filter((project) =>
        isOlderThanDays(project.updated_at, projectOlderThanDays)
    );
    const allStorageProjectIds = storageProjects.filter((project) => !project.active).map((project) =>
        project.project_id
    );
    const allIntermediateProjectIds = storageProjects.filter((project) => !project.active && project.has_intermediate)
        .map((project) => project.project_id);
    const storageModels = storageUsage?.models || [];
    const storageRuntimes = storageUsage?.runtimes || [];
    const storageOtherItems = storageUsage?.other_items || [];
    const externalCacheItem = storageOtherItems.find((item) => item.relative_path === "cache");
    const safeCleanupAvailable =
        (storageUsage?.projects || []).some((project) => !project.active && project.has_intermediate)
        || Boolean(externalCacheItem?.removable);

    return (
        <ModalShell
            open={open}
            onClose={onClose}
            ariaLabel={t.title}
            closeLabel={t.close}
            modalClassName="settings-modal"
        >
            <div className="about-header settings-header">
                <h2>{t.title}</h2>
                <button type="button" onClick={onClose}>{t.close}</button>
            </div>

            <section className="settings-section">
                <h3>{t.general.title}</h3>
                <div className="roller-form two-col">
                    <label>
                        {t.general.language}
                        <select
                            value={prefState.lang}
                            onChange={(ev) => prefDispatch({ type: "lang", payload: ev.target.value })}
                        >
                            {i18n.langMap.map(([code, name]: [string, string]) => (
                                <option key={code} value={code}>{name}</option>
                            ))}
                        </select>
                    </label>
                    <label>
                        {t.general.themeMode}
                        <select
                            value={prefState.themeMode}
                            onChange={(ev) =>
                                prefDispatch({ type: "themeMode", payload: Number(ev.target.value) as ThemeMode })}
                        >
                            <option value={ThemeMode.auto}>{t.general.themeModeAuto}</option>
                            <option value={ThemeMode.light}>{t.general.themeModeLight}</option>
                            <option value={ThemeMode.dark}>{t.general.themeModeDark}</option>
                        </select>
                    </label>
                    <div className="settings-form-field two-col-span">
                        <span className="settings-field-label">{t.general.themeColor}</span>
                        <div className="theme-color-row">
                            {Object.entries(themeColors).map(([name, color]) => (
                                <button
                                    key={name}
                                    type="button"
                                    className={`theme-color-chip${prefState.themeColor === color ? " active" : ""}`}
                                    style={{ backgroundColor: color }}
                                    title={name}
                                    onClick={() => prefDispatch({ type: "themeColor", payload: color })}
                                />
                            ))}
                            <ColorPicker
                                value={prefState.themeColor}
                                title={t.general.themeColor}
                                onChange={(c) => prefDispatch({ type: "themeColor", payload: c })}
                            />
                            <input
                                type="text"
                                className="theme-hex-input"
                                value={hexInput}
                                onChange={(ev) => {
                                    const v = ev.target.value;
                                    setHexInput(v);
                                    if (/^#[0-9a-fA-F]{6}$/.test(v)) prefDispatch({ type: "themeColor", payload: v });
                                }}
                                onBlur={() => {
                                    if (!/^#[0-9a-fA-F]{6}$/.test(hexInput)) setHexInput(prefState.themeColor);
                                }}
                                placeholder="#23d18b"
                                maxLength={7}
                            />
                        </div>
                    </div>
                </div>
                <SettingsActionRow title={t.general.resetDisplayPrefs}>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                            prefDispatch({ type: "lang", payload: "en-US" });
                            prefDispatch({ type: "themeMode", payload: ThemeMode.dark });
                            prefDispatch({ type: "themeColor", payload: themeColors.logic });
                            prefDispatch({ type: "fixed", payload: 3 });
                            prefDispatch({ type: "spaceStart", payload: 1 });
                            prefDispatch({ type: "spaceEnd", payload: 0 });
                            prefDispatch({ type: "builtInAudio", payload: false });
                            prefDispatch({ type: "showWaveform", payload: true });
                            prefDispatch({ type: "screenButton", payload: false });
                            toastPubSub.pub({ type: "success", text: u.displayPrefsReset });
                        }}
                    >
                        {t.common.reset}
                    </button>
                </SettingsActionRow>
                <SettingsActionRow title={t.general.resetDefaults}>
                    <button
                        className="danger-action"
                        type="button"
                        disabled={busy}
                        onClick={() => void resetDefaults()}
                    >
                        {t.common.reset}
                    </button>
                </SettingsActionRow>
            </section>

            <section className="settings-section">
                <h3>{t.project.title}</h3>
                <div className="roller-form two-col">
                    <label>
                        {t.project.projectListShown}
                        <input
                            inputMode="numeric"
                            value={recentProjectsLimit}
                            onChange={(ev) => setRecentProjectsLimit(ev.target.value)}
                            onBlur={() => {
                                const parsed = Number(recentProjectsLimit);
                                const value = Number.isFinite(parsed) && parsed > 0
                                    ? Math.max(1, Math.round(parsed))
                                    : 8;
                                setRecentProjectsLimit(String(value));
                                void savePatch({ recent_projects_limit: value }, t.messages.projectLimitSaved);
                            }}
                        />
                    </label>
                </div>
            </section>

            <section className="settings-section">
                <h3>{t.importAudio.title}</h3>
                <SettingsCheckRow
                    checked={prefState.builtInAudio}
                    title={t.general.builtInAudio}
                    description={t.general.builtInAudioDesc}
                    onChange={() => {
                        prefDispatch({ type: "builtInAudio", payload: (s) => !s.builtInAudio });
                    }}
                />
                <SettingsCheckRow
                    checked={prefState.showWaveform}
                    title={t.general.showWaveform}
                    description={t.general.showWaveformDesc}
                    onChange={() => {
                        prefDispatch({ type: "showWaveform", payload: (s) => !s.showWaveform });
                    }}
                />
                <SettingsCheckRow
                    checked={audioRegexEnabled}
                    disabled={busy}
                    title={t.importAudio.extractMetadata}
                    description={t.importAudio.extractMetadataDesc}
                    onChange={(checked) => {
                        setAudioRegexEnabled(checked);
                        void savePatch({ audio_filename_regex_enabled: checked });
                    }}
                />
                <div className="roller-form settings-form-spaced">
                    <label>
                        {t.importAudio.regexPattern}
                        <input
                            placeholder="(?P&lt;artist&gt;.+?) - (?P&lt;track&gt;.+?)"
                            value={audioRegex}
                            onChange={(ev) => setAudioRegex(ev.target.value)}
                            onBlur={() => {
                                void savePatch({ audio_filename_regex: audioRegex }, t.messages.regexSaved);
                            }}
                            disabled={!audioRegexEnabled}
                        />
                    </label>
                </div>
            </section>

            <section className="settings-section">
                <h3>{t.importLyrics.title}</h3>
                <SettingsCheckRow
                    checked={autoFillLibrary}
                    disabled={busy}
                    title={t.importLyrics.autoFill}
                    description={t.importLyrics.autoFillDesc}
                    onChange={(checked) => {
                        setAutoFillLibrary(checked);
                        void savePatch({ auto_fill_lyrics_library_from_project_metadata: checked });
                    }}
                />
            </section>

            <section className="settings-section">
                <h3>{t.syncEditor.title}</h3>
                <SettingsCheckRow
                    checked={editorWriteMetadataTags}
                    disabled={busy}
                    title={t.syncEditor.writeMetadata}
                    description={t.syncEditor.writeMetadataDesc}
                    onChange={(checked) => {
                        setEditorWriteMetadataTags(checked);
                        void savePatch({ editor_write_metadata_tags: checked }, t.messages.metadataTagSaved);
                    }}
                />
                <SettingsCheckRow
                    checked={prefState.screenButton}
                    title={t.syncEditor.screenButton}
                    description={t.syncEditor.screenButtonDesc}
                    onChange={() => {
                        prefDispatch({ type: "screenButton", payload: (s) => !s.screenButton });
                    }}
                />
                <div className="roller-form two-col settings-form-spaced">
                    <label>
                        {t.syncEditor.timestampDecimals}
                        <select
                            value={prefState.fixed}
                            onChange={(ev) =>
                                prefDispatch({ type: "fixed", payload: Number(ev.target.value) as Fixed })}
                        >
                            <option value={0}>0</option>
                            <option value={1}>1</option>
                            <option value={2}>2</option>
                            <option value={3}>3</option>
                        </select>
                    </label>
                    <SpaceStepper
                        label={t.syncEditor.leftSpace}
                        value={prefState.spaceStart}
                        onChange={(value) => prefDispatch({ type: "spaceStart", payload: value })}
                    />
                    <SpaceStepper
                        label={t.syncEditor.rightSpace}
                        value={prefState.spaceEnd}
                        onChange={(value) => prefDispatch({ type: "spaceEnd", payload: value })}
                    />
                </div>
                <SettingsActionRow title={t.syncEditor.workspaceBg} description={t.syncEditor.workspaceBgDesc}>
                    <input ref={bgInputRef} type="file" accept="image/*" hidden onChange={onBgUpload} />
                    <button type="button" onClick={() => bgInputRef.current?.click()}>{t.common.upload}</button>
                    <button type="button" onClick={resetBg}>{t.common.reset}</button>
                </SettingsActionRow>
            </section>

            <section className="settings-section">
                <h3>{t.autoTiming.title}</h3>
                <div className="settings-subsection">
                    <div className="roller-section-title">{t.autoTiming.runtime}</div>
                    <div className="roller-form settings-profile-row">
                        <label>
                            {t.autoTiming.runtimeProfile}
                            <select
                                value={profile}
                                disabled={busy || runtimeJobRunning}
                                onChange={(ev) => void saveProfile(ev.target.value as Profile)}
                            >
                                <option value="auto">{t.general.themeModeAuto}</option>
                                <option value="cpu">{u.cpuOnly}</option>
                                <option value="cu124">{u.cuda124}</option>
                            </select>
                        </label>
                    </div>
                    <SettingsActionRow title={t.autoTiming.runtimeCheck} description={t.autoTiming.runtimeCheckDesc}>
                        <button
                            type="button"
                            disabled={busy || runtimeJobRunning}
                            title={busy ? t.runtime.busy : runtimeJobRunning ? t.runtime.jobRunning : ""}
                            onClick={runDoctor}
                        >
                            {t.autoTiming.checkAction}
                        </button>
                    </SettingsActionRow>
                    <SettingsActionRow
                        title={t.autoTiming.runtimeEnvironment}
                        description={t.autoTiming.runtimeEnvironmentDesc}
                    >
                        <button
                            type="button"
                            disabled={busy || runtimeJobRunning}
                            title={busy ? t.runtime.busy : runtimeJobRunning ? t.runtime.jobRunning : ""}
                            onClick={() => void runInstall()}
                        >
                            {t.autoTiming.createRuntime}
                        </button>
                    </SettingsActionRow>
                    <SettingsActionRow
                        title={t.autoTiming.pyrollerPackage}
                        description={t.autoTiming.pyrollerPackageDesc}
                    >
                        <button
                            type="button"
                            disabled={busy || runtimeJobRunning || runtime?.runtime_status !== "ready"}
                            title={busy
                                ? t.runtime.busy
                                : runtimeJobRunning
                                ? t.runtime.jobRunning
                                : runtime?.runtime_status !== "ready"
                                ? t.runtime.notReady
                                : ""}
                            onClick={() => void runUpgrade()}
                        >
                            {t.autoTiming.upgradeAction}
                        </button>
                    </SettingsActionRow>
                    <SettingsActionRow title={t.autoTiming.modelCache} description={t.autoTiming.modelCacheDesc}>
                        <button
                            type="button"
                            disabled={busy || runtimeJobRunning || runtime?.runtime_status !== "ready"}
                            title={busy
                                ? t.runtime.busy
                                : runtimeJobRunning
                                ? t.runtime.jobRunning
                                : runtime?.runtime_status !== "ready"
                                ? t.runtime.notReady
                                : ""}
                            onClick={() => void runCacheModel()}
                        >
                            {t.autoTiming.preDownload}
                        </button>
                    </SettingsActionRow>
                    <SettingsActionRow title={t.autoTiming.diagnostics} description={t.autoTiming.diagnosticsDesc}>
                        <button type="button" onClick={copyDiagnostics}>{t.autoTiming.copyAction}</button>
                        <button type="button" onClick={() => void refresh(true)}>{t.autoTiming.refreshAction}</button>
                    </SettingsActionRow>
                    {runtimeJobRunning && (
                        <SettingsActionRow title={t.autoTiming.currentJob} description={t.autoTiming.currentJobDesc}>
                            <button
                                type="button"
                                disabled={busy}
                                title={busy ? t.runtime.busy : ""}
                                onClick={cancelRuntimeJob}
                            >
                                {t.common.cancel}
                            </button>
                        </SettingsActionRow>
                    )}
                    {runtimeError && <p className="roller-message error runtime-local-notice">{runtimeError}</p>}
                    {job && (
                        <RuntimeJobTerminal
                            job={job}
                            elapsed={runtimeJobElapsed}
                            lastOutput={runtimeJobLastOutput}
                            tr={t.runtime}
                            jobLabels={t.runtime}
                            jobMsg={{
                                taskComplete: t.runtime.taskComplete,
                                runtimeReady: t.runtime.runtimeReady,
                                upgradedTo: t.runtime.upgradedTo,
                                upgraded: t.runtime.upgraded,
                                cacheModelDone: t.runtime.cacheModelDone,
                            }}
                            backendMessages={lang.backendMessages}
                        />
                    )}
                </div>

                <div className="settings-subsection">
                    <div className="roller-section-title">{t.autoTiming.parameters}</div>
                    <AutoTimingFields at={at} labels={t.autoTiming} optionLabel={trOpt} />
                </div>
            </section>

            <section className="settings-section">
                <h3>{t.upload.title}</h3>
                <SettingsCheckRow
                    checked={uploadDerivePlain}
                    disabled={busy}
                    title={t.upload.derivePlain}
                    description={t.upload.derivePlainDesc}
                    onChange={(checked) => {
                        setUploadDerivePlain(checked);
                        void savePatch({ upload_derive_plain_from_synced: checked });
                    }}
                />
            </section>

            <section className="settings-section storage-cleanup-section">
                <h3>{t.storage.title}</h3>
                <div className="settings-subsection">
                    <div className="roller-section-title">{t.storage.locations}</div>
                    <div className="settings-action-row storage-location-summary">
                        <div className="settings-action-main storage-location-total">
                            <b>{t.storage.totalData}</b>
                            <small>{storageUsage?.data_dir || runtime?.data_dir || trOpt("loading")}</small>
                            <div className="storage-location-meta">
                                <span>{formatBytes(storageUsage?.total_bytes)}</span>
                            </div>
                        </div>
                        <div className="settings-action-buttons">
                            <button type="button" disabled={storageBusy} onClick={() => void openStorageFolder()}>
                                {t.common.openFolder}
                            </button>
                            <button
                                type="button"
                                disabled={storageBusy || !safeCleanupAvailable}
                                onClick={() => void runStorageCleanupDirect(["safe"])}
                            >
                                {t.storage.safeCleanup}
                            </button>
                        </div>
                    </div>
                    <div className="storage-location-list">
                        {(storageUsage?.roots || []).map((root) => {
                            const targetPath = storageTargetPaths[root.id] ?? root.path;
                            const changed = targetPath.trim() !== root.path;
                            return (
                                <div
                                    className={`storage-location-row ${root.movable ? "movable" : "fixed"} ${
                                        root.active ? "active" : ""
                                    }`}
                                    key={root.id}
                                >
                                    <div className="storage-location-copy">
                                        <b>{tl(root.label)}</b>
                                        <small title={root.path}>{root.path}</small>
                                        <div className="storage-location-meta">
                                            <span>{formatBytes(root.bytes)}</span>
                                            <span>{u.filesUnit.replace("{n}", String(root.file_count))}</span>
                                            {root.active && (
                                                <span className="storage-location-pill">{t.storage.active}</span>
                                            )}
                                            {root.path !== root.default_path && (
                                                <span className="storage-location-pill">
                                                    {t.storage.customLocation}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="storage-location-control">
                                        {root.movable
                                            ? (
                                                <label>
                                                    <span>{t.storage.targetLocation}</span>
                                                    <span className="storage-location-input">
                                                        <input
                                                            value={targetPath}
                                                            disabled={storageBusy}
                                                            onChange={(ev) =>
                                                                setStorageTargetPaths((current) => ({
                                                                    ...current,
                                                                    [root.id]: ev.target.value,
                                                                }))}
                                                        />
                                                        <button
                                                            type="button"
                                                            disabled={storageBusy}
                                                            onClick={() => void browseStorageRoot(root)}
                                                        >
                                                            {t.common.browse}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={storageBusy || !changed}
                                                            onClick={() => void migrateStorageRoot(root)}
                                                        >
                                                            {t.storage.moveHere}
                                                        </button>
                                                    </span>
                                                </label>
                                            )
                                            : (
                                                <div className="storage-location-static">
                                                    <span>{t.storage.fixedLocation}</span>
                                                </div>
                                            )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <details open>
                    <summary>{t.storage.projects}</summary>
                    <div className="storage-project-toolbar">
                        <div className="roller-form two-col storage-project-controls">
                            <label>
                                {t.storage.olderThan}
                                <select
                                    value={storageOlderThanDays}
                                    onChange={(ev) => setStorageOlderThanDays(ev.target.value)}
                                >
                                    <option value="0">{t.storage.all}</option>
                                    <option value="1">{t.storage.oneDay}</option>
                                    <option value="7">{t.storage.sevenDays}</option>
                                    <option value="30">{t.storage.thirtyDays}</option>
                                </select>
                            </label>
                            <label>
                                {t.storage.autoDeleteAfterDays}
                                <input
                                    inputMode="numeric"
                                    min={0}
                                    value={projectAutoDeleteDays}
                                    onChange={(ev) => setProjectAutoDeleteDays(ev.target.value)}
                                    onBlur={() => {
                                        setProjectAutoDeleteDays(String(normalizedAutoDeleteDays));
                                        void savePatch(
                                            { project_auto_delete_days: normalizedAutoDeleteDays },
                                            t.messages.saved,
                                        ).then(() => refreshStorage());
                                    }}
                                />
                            </label>
                        </div>
                        <div className="roller-actions storage-actions">
                            <button
                                type="button"
                                disabled={storageBusy || allIntermediateProjectIds.length === 0}
                                onClick={() =>
                                    void runStorageCleanupDirect(["clear_intermediate"], {
                                        projectIds: allIntermediateProjectIds,
                                    })}
                            >
                                {t.storage.clearIntermediates}
                            </button>
                            <button
                                className="danger-action"
                                type="button"
                                disabled={storageBusy || allStorageProjectIds.length === 0}
                                onClick={() =>
                                    void runStorageCleanupDirect(["delete_projects"], {
                                        projectIds: allStorageProjectIds,
                                        confirmation: t.storage.confirmDeleteProjects.replace(
                                            "{count}",
                                            String(allStorageProjectIds.length),
                                        ),
                                    })}
                            >
                                {t.common.delete}
                            </button>
                        </div>
                    </div>
                    <div className="storage-project-list">
                        {storageProjects.length === 0 && <p className="roller-message subtle">{t.storage.noProjects}
                        </p>}
                        {storageProjects.map((project) => (
                            <div
                                className={`storage-project-row ${project.active ? "blocked" : ""}`}
                                key={project.project_id}
                            >
                                <div className="storage-project-main">
                                    <b>{project.title || project.project_id}</b>
                                    <small>
                                        {project.artist || u.unknownArtist} · {project.project_id}
                                        {project.active ? ` · ${t.runtime.running}` : ""}
                                    </small>
                                    <div className="storage-project-breakdown">
                                        <span>{tl("Total")} {formatBytes(project.total_bytes)}</span>
                                        <span>{tl("Intermediate")} {formatBytes(project.intermediate_bytes)}</span>
                                    </div>
                                </div>
                                <div className="storage-project-actions">
                                    <button
                                        type="button"
                                        disabled={storageBusy || project.active || !project.has_intermediate}
                                        onClick={() =>
                                            void runStorageCleanupDirect(["clear_intermediate"], {
                                                projectIds: [project.project_id],
                                            })}
                                    >
                                        {t.storage.clearIntermediates}
                                    </button>
                                    <button
                                        className="danger-action"
                                        type="button"
                                        disabled={storageBusy || project.active}
                                        onClick={() =>
                                            void runStorageCleanupDirect(["delete_projects"], {
                                                projectIds: [project.project_id],
                                                confirmation: t.storage.confirmDeleteProject,
                                            })}
                                    >
                                        {t.common.delete}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </details>

                <details>
                    <summary>{t.storage.models}</summary>
                    <div className="roller-actions storage-actions">
                        <button
                            className="danger-action"
                            type="button"
                            disabled={storageBusy || storageModels.length === 0
                                || storageModels.some((item) => item.active)}
                            onClick={() =>
                                void runStorageCleanupDirect(["delete_model_items"], {
                                    modelIds: storageModels.map((item) => item.id),
                                    confirmation: t.storage.confirmDeleteModels.replace(
                                        "{count}",
                                        String(storageModels.length),
                                    ),
                                })}
                        >
                            {t.storage.deleteAllModels}
                        </button>
                    </div>
                    <div className="storage-item-list">
                        {storageModels.length === 0 && <p className="roller-message subtle">{t.storage.noModels}</p>}
                        {storageModels.map((item) => (
                            <div className="storage-item-row" key={item.id}>
                                <div className="storage-project-main">
                                    <b>{tl(item.label)}</b>
                                    <small>
                                        {item.provider || t.storage.model}
                                        {item.backend ? ` · ${item.backend}` : ""} · {item.relative_path}
                                    </small>
                                    <div className="storage-project-breakdown">
                                        <span>{formatBytes(item.bytes)}</span>
                                        <span>{u.filesUnit.replace("{n}", String(item.file_count))}</span>
                                    </div>
                                </div>
                                <div className="storage-project-actions">
                                    <button
                                        type="button"
                                        disabled={storageBusy}
                                        onClick={() => void openModelFolder(item.id)}
                                    >
                                        {t.common.openFolder}
                                    </button>
                                    <button
                                        className="danger-action"
                                        type="button"
                                        disabled={storageBusy || item.active}
                                        onClick={() =>
                                            void runStorageCleanupDirect(["delete_model_items"], {
                                                modelIds: [item.id],
                                                confirmation: t.storage.confirmDeleteModel.replace(
                                                    "{label}",
                                                    tl(item.label),
                                                ),
                                            })}
                                    >
                                        {t.common.delete}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </details>

                <details>
                    <summary>{t.storage.runtimeEnvs}</summary>
                    <div className="roller-actions storage-actions">
                        <button
                            className="danger-action"
                            type="button"
                            disabled={storageBusy || storageRuntimes.every((item) => !item.removable)}
                            onClick={() =>
                                void runStorageCleanupDirect(["clean_runtime_envs"], {
                                    runtimeIds: storageRuntimes.filter((item) => item.removable).map((item) =>
                                        item.runtime_id
                                    ),
                                    confirmation: t.storage.confirmDeleteRuntimes,
                                })}
                        >
                            {t.storage.deleteInactiveRuntimes}
                        </button>
                    </div>
                    <div className="storage-item-list">
                        {storageRuntimes.length === 0 && <p className="roller-message subtle">{t.storage.noRuntimes}
                        </p>}
                        {storageRuntimes.map((item) => (
                            <div className="storage-item-row" key={item.runtime_id}>
                                <div className="storage-project-main">
                                    <b>{item.runtime_id}{item.active ? ` · ${t.storage.active}` : ""}</b>
                                    <small>
                                        {item.profile || t.storage.profile} · {trOpt(item.status)}
                                        {item.pyroller_version ? ` · py-roller ${item.pyroller_version}` : ""}
                                        {item.python_version ? ` · Python ${item.python_version}` : ""}
                                    </small>
                                    <div className="storage-project-breakdown">
                                        <span>{formatBytes(item.bytes)}</span>
                                        <span>{u.filesUnit.replace("{n}", String(item.file_count))}</span>
                                    </div>
                                </div>
                                <div className="storage-project-actions">
                                    <button
                                        type="button"
                                        disabled={storageBusy}
                                        onClick={() => void openRuntimeFolder(item.runtime_id)}
                                    >
                                        {t.common.openFolder}
                                    </button>
                                    <button
                                        className="danger-action"
                                        type="button"
                                        disabled={storageBusy || !item.removable}
                                        onClick={() =>
                                            void runStorageCleanupDirect(["clean_runtime_envs"], {
                                                runtimeIds: [item.runtime_id],
                                                confirmation: t.storage.confirmDeleteRuntime.replace(
                                                    "{id}",
                                                    item.runtime_id,
                                                ),
                                            })}
                                    >
                                        {t.common.delete}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </details>

                <details>
                    <summary>{t.storage.other}</summary>
                    <div className="storage-item-list">
                        {storageOtherItems.length === 0 && <p className="roller-message subtle">{t.storage.noOther}</p>}
                        {storageOtherItems.map((item) => (
                            <div className="storage-item-row" key={item.relative_path}>
                                <div className="storage-project-main">
                                    <b>{tl(item.label)}</b>
                                    <small>{item.relative_path}</small>
                                    <div className="storage-project-breakdown">
                                        <span>{formatBytes(item.bytes)}</span>
                                        <span>{u.filesUnit.replace("{n}", String(item.file_count))}</span>
                                    </div>
                                </div>
                                <div className="storage-project-actions">
                                    <button
                                        type="button"
                                        disabled={storageBusy}
                                        onClick={() => void openOtherFolder(item.relative_path)}
                                    >
                                        {t.common.openFolder}
                                    </button>
                                    {item.removable && (
                                        <button
                                            className="danger-action"
                                            type="button"
                                            disabled={storageBusy}
                                            onClick={() =>
                                                void runStorageCleanupDirect(["delete_other_items"], {
                                                    otherPaths: [item.relative_path],
                                                    confirmation: t.storage.confirmDeleteOther.replace(
                                                        "{label}",
                                                        tl(item.label),
                                                    ),
                                                })}
                                        >
                                            {t.common.delete}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </details>

                <details>
                    <summary>{t.storage.browserStorage}</summary>
                    <SettingsActionRow
                        title={t.storage.browserStorage}
                        description={t.storage.browserStorageDesc}
                        className="storage-browser-action"
                    >
                        <button type="button" disabled={storageBusy} onClick={() => void clearBrowserState()}>
                            {t.storage.clearBrowserState}
                        </button>
                    </SettingsActionRow>
                </details>
            </section>

            <PanelMessage message={message} type={messageType} fading={messageFading} messageKey={messageKey} />
        </ModalShell>
    );
};
