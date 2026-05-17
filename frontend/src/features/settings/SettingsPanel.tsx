import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAutoTimingState } from "../../hooks/useAutoTimingState.js";
import { useMessage } from "../../hooks/useMessage.js";
import { toastPubSub } from "../../components/toast.js";
import { api, type AutoRollerRuntime, type JobModel, type StorageCleanupTarget, type StorageUsage } from "../../shared/api.js";
import { appContext, ChangBits } from "../../components/app.context.js";
import { ThemeMode, themeColor as themeColors } from "../../hooks/usePref.js";
import { ColorPicker } from "./ColorPicker.js";
import { formatBytes, secondsSince } from "../../shared/format.js";
import { optionNodes } from "../../shared/optionNodes.js";
import { notifySettingsUpdated } from "../../shared/settingsEvents.js";
import {
    ALIGNER_BACKEND_OPTIONS,
    CLEANUP_OPTIONS,
    COMPUTE_TYPE_OPTIONS,
    DEMUCS_DEVICE_OPTIONS,
    DEMUCS_MODEL_OPTIONS,
    DEVICE_OPTIONS,
    FILTER_CHAIN_OPTIONS,
    HF_XET_OPTIONS,
    KARAOKE_TAG_OPTIONS,
    LANGUAGE_OPTIONS,
    LOCAL_CACHE_OPTIONS,
    LOG_LEVEL_OPTIONS,
    PARSER_ENCODING_OPTIONS,
    REPETITION_OPTIONS,
    SPACING_OPTIONS,
    SPLITTER_BACKEND_OPTIONS,
    STAGE_OPTIONS,
    VAD_FILTER_OPTIONS,
    WRITER_OPTIONS,
    transcriberBackendOptions,
    transcriberModelOptions,
    type HfXet,
    type Cleanup,
    type KaraokeTag,
    type Language,
    type LocalOnly,
    type LogLevel,
    type Repetition,
    type Spacing,
} from "../roller/autoTimingOptions.js";

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

function runtimeDetailText(detail: string | null | undefined, tr: Record<string, string>): string {
    if (!detail) return "";
    const details: Record<string, string> = {
        "Isolated runtime has not been created yet.": tr.detailMissing,
        "Runtime Python exists, but py-roller is not installed in it.": tr.detailBroken,
        "Runtime exists, but the last doctor check reported problems.": tr.detailUnhealthy,
        "Runtime exists, but no successful doctor check has been recorded yet.": tr.detailUnchecked,
    };
    return details[detail] || detail;
}

function jobStatusText(status: string, tr: Record<string, string>): string {
    return tr[status] || status;
}

function runtimeStepLabel(key: string, fallback: string, tr: Record<string, string>): string {
    const normalized = key.toLowerCase().replace(/-/g, "_");
    if (tr[key]) return tr[key];
    if (normalized.includes("packaging")) return tr.upgradePackaging;
    if (normalized.includes("torch") && (normalized.includes("remove") || normalized.includes("uninstall"))) return tr.removeTorch;
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
    return ((report as { checks: unknown[] }).checks).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")).map((check) => {
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

function runtimeCompletionMessage(job: JobModel, msg: { taskComplete: string; runtimeReady: string; upgradedTo: string; upgraded: string }): string {
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
        return typeof result.message === "string" ? result.message : "";
    }
    if (job.kind === "auto-roller-doctor") return "";
    return job.progress?.message || msg.taskComplete;
}

const RuntimeJobTerminal: React.FC<{ job: JobModel; elapsed: number | null; lastOutput: number | null; tr: Record<string, string>; jobLabels: Record<string, string>; jobMsg: { taskComplete: string; runtimeReady: string; upgradedTo: string; upgraded: string } }> = ({ job, elapsed, lastOutput, tr, jobLabels, jobMsg }) => {
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
                <b>{tr.pid}</b><span>{job.pid || tr.pending}</span>
                <b>{tr.elapsed}</b><span>{runtimeDuration(elapsed, tr)}</span>
                <b>{tr.lastOutput}</b><span>{tr.ago.replace("{time}", runtimeDuration(lastOutput, tr))}</span>
                <b>{tr.exitCode}</b><span>{job.return_code ?? tr.na}</span>
            </div>
            {job.status === "succeeded" && runtimeCompletionMessage(job, jobMsg) && <p className="roller-message success">{runtimeCompletionMessage(job, jobMsg)}</p>}
            {job.status === "failed" && <p className="roller-message error">{runtimeJobErrorText(job.error, tr)}</p>}
            {running && lastOutput !== null && lastOutput > 30 && <p className="roller-message subtle">{tr.noOutput}</p>}
            {steps.length > 0 && (
                <ol className="runtime-step-list">
                    {steps.map((step) => (
                        <li key={step.key} className={`runtime-step ${step.status}`}>
                            <span className="runtime-step-dot" />
                            <span><b>{runtimeStepLabel(step.key, step.label, tr)}</b>{step.message && <small>{step.message}</small>}</span>
                        </li>
                    ))}
                </ol>
            )}
            {checks.length > 0 && (
                <ol className="runtime-step-list">
                    {checks.map((step) => (
                        <li key={step.key} className={`runtime-step ${step.status}`}>
                            <span className="runtime-step-dot" />
                            <span><b>{runtimeStepLabel(step.key, step.label, tr)}</b>{step.message && <small>{step.message}</small>}</span>
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
    const [autoTimingLoaded, setAutoTimingLoaded] = useState(false);
    const skipAutoTimingSave = useRef(true);
    const autoTimingSaveTimer = useRef<number | null>(null);

    const at = useAutoTimingState();

    const [job, setJob] = useState<JobModel | null>(null);
    const { prefState, prefDispatch, lang } = useContext(appContext, ChangBits.prefState | ChangBits.lang);
    const t = lang.settings;

    useEffect(() => { setHexInput(prefState.themeColor); }, [prefState.themeColor]);
    const u = lang.ui;
    const trOpt = (key: string) => (lang.optionLabels as Record<string, string | undefined>)?.[key] || key;
    const tl = (key: string): string => {
        const storageLabels = lang.storageLabels as Record<string, string | undefined>;
        const storageReasons = lang.storageReasons as Record<string, string | undefined>;
        if (key.startsWith("storage_label.")) return storageLabels?.[key.slice(14)] || key;
        if (key.startsWith("storage_reason.")) return storageReasons?.[key.slice(15)] || key;
        return storageLabels?.[key] || key;
    };
    const [message, setMessage, , messageFading, messageType] = useMessage();
    const [runtimeError, setRuntimeError] = useState("");
    const [busy, setBusy] = useState(false);

    const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
    const [storageOlderThanDays, setStorageOlderThanDays] = useState("1");
    const [storageBusy, setStorageBusy] = useState(false);

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
            at.loadFromSettings(settings);
            skipAutoTimingSave.current = true;
            window.setTimeout(() => setAutoTimingLoaded(true), 0);
            if (notify) toastPubSub.pub({ type: "success", text: t.messages.statusRefreshed });
        } catch (error) {
            setMessage((error as Error).message, "error");
        }
    }, []);

    const refreshStorage = useCallback(async () => {
        try {
            const usage = await api.storageUsage();
            setStorageUsage(usage);
        } catch (error) {
            setMessage((error as Error).message, "error");
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
                setMessage((error as Error).message, "error");
            }
        }, 1400);
        return () => window.clearInterval(timer);
    }, [job, refresh]);

    const runtimeJobRunning = Boolean(job && ["queued", "running"].includes(job.status));
    const runtimeJobElapsed = secondsSince(job?.started_at);
    const runtimeJobLastOutput = secondsSince(job?.last_output_at || job?.started_at);

    const savePatch = async (payload: Record<string, unknown>, _success?: string) => {
        setBusy(true);
        setMessage(t.messages.saving, "info", 10000);
        try {
            await api.updateSettings(payload);
            notifySettingsUpdated();
            await refresh();
            toastPubSub.pub({ type: "success", text: t.messages.saved });
        } catch (error) {
            setMessage((error as Error).message, "error");
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
        setMessage(t.messages.resetting, "info", 10000);
        try {
            await api.resetSettingsDefaults();
            notifySettingsUpdated();
            await refresh();
            toastPubSub.pub({ type: "success", text: t.messages.resetDone });
        } catch (error) {
            setMessage((error as Error).message, "error");
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
            setMessage((error as Error).message, "error");
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
            toastPubSub.pub({ type: "error", text: (error as Error).message });
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
            toastPubSub.pub({ type: "error", text: (error as Error).message });
        } finally {
            setBusy(false);
        }
    };

    const browseModelStore = async () => {
        setBusy(true);
        setMessage(t.messages.openingFolder, "info", 10000);
        try {
            const result = await api.selectLocalPath({
                mode: "directory",
                title: "Select model store folder",
                initial_path: at.transcriberModelPath || runtime?.model_store || null,
            });
            if (!result.canceled && result.path) {
                at.setTranscriberModelPath(result.path);
                toastPubSub.pub({ type: "success", text: t.messages.modelStoreSelected });
            } else {
                toastPubSub.pub({ type: "warning", text: t.messages.folderCanceled });
            }
        } catch (error) {
            setMessage((error as Error).message, "error");
        } finally {
            setBusy(false);
        }
    };

    const runDoctor = async () => {
        setBusy(true);
        setRuntimeError("");
        try {
            const created = await api.runAutoRollerDoctor();
            setJob(created);
        } catch (error) {
            setRuntimeError((error as Error).message);
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
        } catch (error) {
            setRuntimeError((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const copyDiagnostics = async () => {
        const text = JSON.stringify({ runtime, doctor_report: runtime?.doctor_report || job?.result?.doctor_report || null, install_report: runtime?.install_report || job?.result?.install_report || null, job }, null, 2);
        try {
            await navigator.clipboard?.writeText(text);
            toastPubSub.pub({ type: "success", text: t.messages.diagnosticsCopied });
        } catch (error) {
            toastPubSub.pub({ type: "error", text: (error as Error).message });
        }
    };

    const runUpgrade = async () => {
        setBusy(true);
        setRuntimeError("");
        try {
            const created = await api.upgradeAutoRoller({ profile });
            setJob(created);
        } catch (error) {
            setRuntimeError((error as Error).message);
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
                transcriber_model_path: at.transcriberModelPath || null,
            });
            setJob(created);
        } catch (error) {
            setRuntimeError((error as Error).message);
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
            setRuntimeError((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const runStorageCleanupDirect = async (
        targets: StorageCleanupTarget[],
        options: { projectIds?: string[]; modelIds?: string[]; runtimeIds?: string[]; otherPaths?: string[]; confirmation?: string } = {},
    ) => {
        const projectIds = options.projectIds || [];
        const modelIds = options.modelIds || [];
        const runtimeIds = options.runtimeIds || [];
        const otherPaths = options.otherPaths || [];
        if (projectIds.length === 0 && targets.some((target) => target === "delete_projects" || target === "clear_intermediate")) {
            toastPubSub.pub({ type: "warning", text: t.messages.noProjectsClean });
            return;
        }
        if (modelIds.length === 0 && targets.includes("delete_model_items")) {
            toastPubSub.pub({ type: "warning", text: t.messages.noModelsClean });
            return;
        }
        if (runtimeIds.length === 0 && targets.includes("clean_runtime_envs")) {
            toastPubSub.pub({ type: "warning", text: t.messages.noRuntimesDelete });
            return;
        }
        if (otherPaths.length === 0 && targets.includes("delete_other_items")) {
            toastPubSub.pub({ type: "warning", text: t.messages.noOtherDelete });
            return;
        }
        if (options.confirmation && !window.confirm(options.confirmation)) {
            return;
        }
        setStorageBusy(true);
        setMessage("");
        setMessage(t.messages.cleaning, "info", 10000);
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
            toastPubSub.pub({ type: "success", text: t.messages.deletedEntries.replace("{count}", String(result.deleted_count)).replace("{bytes}", formatBytes(result.deleted_bytes)) + (result.failed.length ? `; ${result.failed.length} failed` : "") });
        } catch (error) {
            setMessage((error as Error).message, "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const clearBrowserState = async () => {
        if (!window.confirm(u.clearBrowserConfirm)) return;
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
            await Promise.all(names.filter((name) => name.startsWith("rollingpebble")).map((name) => caches.delete(name)));
        }
        toastPubSub.pub({ type: "success", text: t.messages.browserCleared });
    };

    const projectOlderThanDays = Number.isFinite(Number(storageOlderThanDays)) ? Math.max(0, Math.round(Number(storageOlderThanDays))) : 0;
    const storageProjects = (storageUsage?.projects || []).filter((project) => isOlderThanDays(project.updated_at, projectOlderThanDays));
    const allStorageProjectIds = storageProjects.filter((project) => !project.active).map((project) => project.project_id);
    const allIntermediateProjectIds = storageProjects.filter((project) => !project.active && project.has_intermediate).map((project) => project.project_id);
    const storageModels = storageUsage?.models || [];
    const storageRuntimes = storageUsage?.runtimes || [];
    const storageOtherItems = storageUsage?.other_items || [];
    const externalCacheItem = storageOtherItems.find((item) => item.relative_path === "cache");
    const safeCleanupAvailable = (storageUsage?.projects || []).some((project) => !project.active && project.has_intermediate) || Boolean(externalCacheItem?.removable);

    if (!open) return null;

    return (
        <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings">
            <button className="settings-backdrop" type="button" onClick={onClose} aria-label="Close settings" />
            <aside className="settings-drawer">
                <div className="settings-header">
                    <h2>{t.title}</h2>
                    <button type="button" onClick={onClose}>{t.close}</button>
                </div>

                <section className="settings-section">
                    <h3>{t.general.title}</h3>
                    <div className="roller-kv">
                        <b>{t.general.appMode}</b><span>Local WebUI</span>
                        <b>{t.general.backend}</b><span>http://127.0.0.1:6789</span>
                        <b>{t.general.frontend}</b><span>http://127.0.0.1:5173</span>
                        <b>{t.general.dataFolder}</b><span>{runtime?.data_dir || "loading"}</span>
                    </div>
                    <div className="roller-form two-col" style={{ marginTop: 10 }}>
                        <label>{t.general.language}<select value={prefState.lang} onChange={(ev) => prefDispatch({ type: "lang", payload: ev.target.value })}>{i18n.langMap.map(([code, name]: [string, string]) => <option key={code} value={code}>{name}</option>)}</select></label>
                        <label>{t.general.themeMode}<select value={prefState.themeMode} onChange={(ev) => prefDispatch({ type: "themeMode", payload: Number(ev.target.value) as ThemeMode })}><option value={ThemeMode.auto}>{t.general.themeModeAuto}</option><option value={ThemeMode.light}>{t.general.themeModeLight}</option><option value={ThemeMode.dark}>{t.general.themeModeDark}</option></select></label>
                        <label className="two-col-span">{t.general.themeColor}<div className="theme-color-row">{Object.entries(themeColors).map(([name, color]) => (<button key={name} type="button" className={`theme-color-chip${prefState.themeColor === color ? " active" : ""}`} style={{ backgroundColor: color }} title={name} onClick={() => prefDispatch({ type: "themeColor", payload: color })} />))}<ColorPicker value={prefState.themeColor} onChange={(c) => prefDispatch({ type: "themeColor", payload: c })} /><input type="text" className="theme-hex-input" value={hexInput} onChange={(ev) => { const v = ev.target.value; setHexInput(v); if (/^#[0-9a-fA-F]{6}$/.test(v)) prefDispatch({ type: "themeColor", payload: v }); }} onBlur={() => { if (!/^#[0-9a-fA-F]{6}$/.test(hexInput)) setHexInput(prefState.themeColor); }} placeholder="#23d18b" maxLength={7} /></div></label>
                    </div>
                    <div className="roller-actions settings-general-actions">
                        <button type="button" disabled={busy} onClick={() => { prefDispatch({ type: "lang", payload: "en-US" }); prefDispatch({ type: "themeMode", payload: ThemeMode.dark }); prefDispatch({ type: "themeColor", payload: themeColors.logic }); prefDispatch({ type: "fixed", payload: 3 }); prefDispatch({ type: "spaceStart", payload: 1 }); prefDispatch({ type: "spaceEnd", payload: 0 }); prefDispatch({ type: "builtInAudio", payload: false }); prefDispatch({ type: "showWaveform", payload: true }); prefDispatch({ type: "screenButton", payload: false }); toastPubSub.pub({ type: "success", text: u.displayPrefsReset }); }}>{t.general.resetDisplayPrefs}</button>
                        <button className="danger-action" type="button" disabled={busy} onClick={() => void resetDefaults()}>{t.general.resetDefaults}</button>
                    </div>
                </section>

                <section className="settings-section">
                    <h3>{t.project.title}</h3>
                    <div className="roller-form two-col">
                        <label>{t.project.projectListShown}<input inputMode="numeric" value={recentProjectsLimit} onChange={(ev) => setRecentProjectsLimit(ev.target.value)} onBlur={() => { const parsed = Number(recentProjectsLimit); const value = Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.round(parsed)) : 8; setRecentProjectsLimit(String(value)); void savePatch({ recent_projects_limit: value }, t.messages.projectLimitSaved); }} /></label>
                    </div>
                </section>

                <section className="settings-section">
                    <h3>{t.importAudio.title}</h3>
                    <label className="settings-check-row"><input type="checkbox" checked={prefState.builtInAudio} onChange={() => { prefDispatch({ type: "builtInAudio", payload: (s) => !s.builtInAudio }); }} /><span><b>{t.general.builtInAudio}</b><small>{t.general.builtInAudioDesc}</small></span></label>
                    <label className="settings-check-row"><input type="checkbox" checked={prefState.showWaveform} onChange={() => { prefDispatch({ type: "showWaveform", payload: (s) => !s.showWaveform }); }} /><span><b>{t.general.showWaveform}</b><small>{t.general.showWaveformDesc}</small></span></label>
                    <label className="settings-check-row"><input type="checkbox" checked={audioRegexEnabled} disabled={busy} onChange={(ev) => { setAudioRegexEnabled(ev.currentTarget.checked); void savePatch({ audio_filename_regex_enabled: ev.currentTarget.checked }); }} /><span><b>{t.importAudio.extractMetadata}</b><small>{t.importAudio.extractMetadataDesc}</small></span></label>
                    <div className="roller-form" style={{ marginTop: 8 }}><label>{t.importAudio.regexPattern}<input placeholder="(?P&lt;artist&gt;.+?) - (?P&lt;track&gt;.+?)" value={audioRegex} onChange={(ev) => setAudioRegex(ev.target.value)} onBlur={() => { void savePatch({ audio_filename_regex: audioRegex }, t.messages.regexSaved); }} disabled={!audioRegexEnabled} /></label></div>
                </section>

                <section className="settings-section">
                    <h3>{t.importLyrics.title}</h3>
                    <label className="settings-check-row"><input type="checkbox" checked={autoFillLibrary} disabled={busy} onChange={(ev) => { setAutoFillLibrary(ev.currentTarget.checked); void savePatch({ auto_fill_lyrics_library_from_project_metadata: ev.currentTarget.checked }); }} /><span><b>{t.importLyrics.autoFill}</b><small>{t.importLyrics.autoFillDesc}</small></span></label>
                </section>

                <section className="settings-section">
                    <h3>{t.syncEditor.title}</h3>
                    <label className="settings-check-row"><input type="checkbox" checked={editorWriteMetadataTags} disabled={busy} onChange={(ev) => { setEditorWriteMetadataTags(ev.currentTarget.checked); void savePatch({ editor_write_metadata_tags: ev.currentTarget.checked }, t.messages.metadataTagSaved); }} /><span><b>{t.syncEditor.writeMetadata}</b><small>{t.syncEditor.writeMetadataDesc}</small></span></label>
                    <label className="settings-check-row"><input type="checkbox" checked={prefState.screenButton} onChange={() => { prefDispatch({ type: "screenButton", payload: (s) => !s.screenButton }); }} /><span><b>{t.syncEditor.screenButton}</b><small>{t.syncEditor.screenButtonDesc}</small></span></label>
                    <div className="roller-form two-col" style={{ marginTop: 10 }}>
                        <label>{t.syncEditor.timestampDecimals}<select value={prefState.fixed} onChange={(ev) => prefDispatch({ type: "fixed", payload: Number(ev.target.value) as Fixed })}><option value={0}>0</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
                        <label>{t.syncEditor.leftSpace}<span className="stepper-row"><button type="button" className="stepper-btn" onClick={() => prefDispatch({ type: "spaceStart", payload: Math.max(0, prefState.spaceStart - 1) })}>−</button><span className="stepper-val">{prefState.spaceStart}</span><button type="button" className="stepper-btn" onClick={() => prefDispatch({ type: "spaceStart", payload: prefState.spaceStart + 1 })}>+</button></span></label>
                        <label>{t.syncEditor.rightSpace}<span className="stepper-row"><button type="button" className="stepper-btn" onClick={() => prefDispatch({ type: "spaceEnd", payload: Math.max(0, prefState.spaceEnd - 1) })}>−</button><span className="stepper-val">{prefState.spaceEnd}</span><button type="button" className="stepper-btn" onClick={() => prefDispatch({ type: "spaceEnd", payload: prefState.spaceEnd + 1 })}>+</button></span></label>
                    </div>
                    <label className="settings-check-row" style={{ cursor: "default" }}>
                        <span style={{ flex: 1 }}><b>{t.syncEditor.workspaceBg}</b><small>{t.syncEditor.workspaceBgDesc}</small></span>
                        <input ref={bgInputRef} type="file" accept="image/*" hidden onChange={onBgUpload} />
                        <button type="button" onClick={() => bgInputRef.current?.click()}>{t.common.upload}</button>
                        <button type="button" onClick={resetBg}>{t.common.reset}</button>
                    </label>
                </section>

                <section className="settings-section">
                    <h3>{t.autoTiming.title}</h3>
                    <div className="settings-subsection">
                        <h4>{t.autoTiming.runtime}</h4>
                        <div className="roller-kv">
                            <b>{t.autoTiming.status}</b><span>{trOpt(runtime?.runtime_status || "loading")}</span>
                            <b>{t.autoTiming.version}</b><span>{runtime?.version || trOpt("not installed")}</span>
                            <b>{t.autoTiming.required}</b><span>{runtime?.runtime_requirement || trOpt("loading")}</span>
                            <b>{t.autoTiming.runtimeFolder}</b><span>{runtime?.runtime_root || trOpt("not created")}</span>
                            <b>{t.autoTiming.modelStore}</b><span>{at.transcriberModelPath || runtime?.model_store || trOpt("unknown")}</span>
                            <b>{t.autoTiming.lastCheck}</b><span>{trOpt(runtime?.settings.last_doctor_status || "not run")} {runtime?.settings.last_doctor_at ? `· ${runtime.settings.last_doctor_at}` : ""}</span>
                            <b>{t.autoTiming.lastInstall}</b><span>{trOpt(runtime?.settings.last_install_status || runtime?.settings.last_install_profile || "not run")} {runtime?.settings.last_install_at ? `· ${runtime.settings.last_install_at}` : ""}</span>
                        </div>
                        {runtime?.detail && <p className="roller-message subtle">{runtimeDetailText(runtime.detail, t.runtime)}</p>}
                        <div className="roller-form settings-profile-row"><label>{t.autoTiming.runtimeProfile}<select value={profile} disabled={busy || runtimeJobRunning} onChange={(ev) => void saveProfile(ev.target.value as Profile)}><option value="auto">{t.general.themeModeAuto}</option><option value="cpu">{u.cpuOnly}</option><option value="cu124">{u.cuda124}</option></select></label></div>
                        <div className="roller-actions runtime-actions"><button type="button" disabled={busy || runtimeJobRunning} title={busy ? t.runtime.busy : runtimeJobRunning ? t.runtime.jobRunning : ""} onClick={runDoctor}>{t.autoTiming.runtimeCheck}</button><button type="button" disabled={busy || runtimeJobRunning} title={busy ? t.runtime.busy : runtimeJobRunning ? t.runtime.jobRunning : ""} onClick={() => void runInstall()}>{t.autoTiming.createRuntime}</button><button type="button" disabled={busy || runtimeJobRunning || runtime?.runtime_status !== "ready"} title={busy ? t.runtime.busy : runtimeJobRunning ? t.runtime.jobRunning : runtime?.runtime_status !== "ready" ? t.runtime.notReady : ""} onClick={() => void runUpgrade()}>{t.autoTiming.upgradePyroller}</button><button type="button" disabled={busy || runtimeJobRunning || runtime?.runtime_status !== "ready"} title={busy ? t.runtime.busy : runtimeJobRunning ? t.runtime.jobRunning : runtime?.runtime_status !== "ready" ? t.runtime.notReady : ""} onClick={() => void runCacheModel()}>{t.autoTiming.preDownload}</button>{runtimeJobRunning && <button type="button" disabled={busy} title={busy ? t.runtime.busy : ""} onClick={cancelRuntimeJob}>{t.common.cancel}</button>}<button type="button" onClick={copyDiagnostics}>{t.autoTiming.copyDiagnostics}</button><button type="button" onClick={() => void refresh(true)}>{t.autoTiming.refreshStatus}</button></div>
                        {runtimeError && <p className="roller-message error runtime-local-notice">{runtimeError}</p>}
                        {job && <RuntimeJobTerminal job={job} elapsed={runtimeJobElapsed} lastOutput={runtimeJobLastOutput} tr={t.runtime} jobLabels={t.runtime} jobMsg={{ taskComplete: t.runtime.taskComplete, runtimeReady: t.runtime.runtimeReady, upgradedTo: t.runtime.upgradedTo, upgraded: t.runtime.upgraded }} />}
                    </div>

                    <div className="settings-subsection">
                        <div className="roller-section-title">{t.autoTiming.parameters}</div>
                        <div className="roller-form two-col">
                            <label>{t.autoTiming.lyricsLanguage}<select value={at.language} onChange={(ev) => at.setLanguage(ev.target.value as Language)}>{optionNodes(LANGUAGE_OPTIONS, trOpt)}</select></label>
                            <label>{t.autoTiming.processingPreset}<select value={at.stages} onChange={(ev) => at.setStages(ev.target.value)}>{optionNodes(STAGE_OPTIONS, trOpt)}</select></label>
                            <label>{t.autoTiming.outputFormat}<select value={at.writerBackend} onChange={(ev) => at.setWriterBackend(ev.target.value)}>{optionNodes(WRITER_OPTIONS, trOpt)}</select></label>
                            <label>{t.autoTiming.repetitionHandling}<select value={at.alignerRepetition} onChange={(ev) => at.setAlignerRepetition(ev.target.value as Repetition)}>{optionNodes(REPETITION_OPTIONS, trOpt)}</select></label>
                            <label className="field-with-browse">{t.autoTiming.modelStoreLabel}<span className="browse-row"><input placeholder={runtime?.model_store || "~/.local/share/rollingpebble/models/transcriber"} value={at.transcriberModelPath} onChange={(ev) => at.setTranscriberModelPath(ev.target.value)} /><button type="button" disabled={busy} onClick={browseModelStore}>{t.common.browse}</button></span></label>
                            <label>{t.autoTiming.spacing}<select value={at.writerSpacing} onChange={(ev) => at.setWriterSpacing(ev.target.value as Spacing)}>{optionNodes(SPACING_OPTIONS, trOpt)}</select></label>
                        </div>

                        <details>
                            <summary>{t.autoTiming.advanced}</summary>
                            <div className="roller-section-title">{t.autoTiming.pipelineRuntime}</div>
                            <div className="roller-form two-col">
                                <label>{t.autoTiming.cleanupPolicy}<select value={at.cleanup} onChange={(ev) => at.setCleanup(ev.target.value as Cleanup)}>{optionNodes(CLEANUP_OPTIONS, trOpt)}</select></label>
                                <label>{t.autoTiming.logLevel}<select value={at.logLevel} onChange={(ev) => at.setLogLevel(ev.target.value as LogLevel)}>{optionNodes(LOG_LEVEL_OPTIONS, trOpt)}</select></label>
                            </div>

                            <div className="roller-section-title">{t.autoTiming.modelDownload}</div>
                            <div className="roller-form two-col">
                                <label>{t.autoTiming.hfXet}<select value={at.hfXet} onChange={(ev) => at.setHfXet(ev.target.value as HfXet)}>{optionNodes(HF_XET_OPTIONS, trOpt)}</select></label>
                                <label>{t.autoTiming.proxyUrl}<input placeholder="http://127.0.0.1:7890" value={at.hfProxy} onChange={(ev) => at.setHfProxy(ev.target.value)} /></label>
                                <label>{t.autoTiming.metadataTimeout}<input inputMode="numeric" placeholder={trOpt("Library built-in")} value={at.hfEtagTimeout} onChange={(ev) => at.setHfEtagTimeout(ev.target.value)} /></label>
                                <label>{t.autoTiming.fileDownloadTimeout}<input inputMode="numeric" placeholder={trOpt("Library built-in")} value={at.hfDownloadTimeout} onChange={(ev) => at.setHfDownloadTimeout(ev.target.value)} /></label>
                                <label>{t.autoTiming.maxDownloadWorkers}<input inputMode="numeric" placeholder={trOpt("Library built-in")} value={at.hfMaxWorkers} onChange={(ev) => at.setHfMaxWorkers(ev.target.value)} /></label>
                                <label>{t.autoTiming.localCacheMode}<select value={at.localOnly} onChange={(ev) => at.setLocalOnly(ev.target.value as LocalOnly)}>{optionNodes(LOCAL_CACHE_OPTIONS, trOpt)}</select></label>
                            </div>

                            <div className="roller-section-title">{t.autoTiming.splitter}</div>
                            <div className="roller-form two-col">
                                <label>{t.autoTiming.backend}<select value={at.splitterBackend} onChange={(ev) => at.setSplitterBackend(ev.target.value)}>{optionNodes(SPLITTER_BACKEND_OPTIONS, trOpt)}</select></label>
                                <label>{t.autoTiming.demucsModel}<select value={at.splitterModel} onChange={(ev) => at.setSplitterModel(ev.target.value)}>{optionNodes(DEMUCS_MODEL_OPTIONS, trOpt)}</select></label>
                                <label>{t.autoTiming.device}<select value={at.splitterDevice} onChange={(ev) => at.setSplitterDevice(ev.target.value)}>{optionNodes(DEMUCS_DEVICE_OPTIONS, trOpt)}</select></label>
                                <label>{t.autoTiming.jobs}<input inputMode="numeric" placeholder={trOpt("Auto-detect")} value={at.splitterJobs} onChange={(ev) => at.setSplitterJobs(ev.target.value)} /></label>
                                <label>{t.autoTiming.overlap}<input inputMode="decimal" placeholder={trOpt("Default")} value={at.splitterOverlap} onChange={(ev) => at.setSplitterOverlap(ev.target.value)} /></label>
                                <label>{t.autoTiming.segment}<input inputMode="decimal" placeholder={trOpt("Default")} value={at.splitterSegment} onChange={(ev) => at.setSplitterSegment(ev.target.value)} /></label>
                            </div>

                            <div className="roller-section-title">{t.autoTiming.filter}</div>
                            <div className="roller-form"><label>{t.autoTiming.filterChain}<select value={at.filterChain} onChange={(ev) => at.setFilterChain(ev.target.value)}>{optionNodes(FILTER_CHAIN_OPTIONS, trOpt)}</select></label></div>

                            <div className="roller-section-title">{t.autoTiming.transcriber}</div>
                            <div className="roller-form two-col">
                                <label>{t.autoTiming.backend}<select value={at.transcriberBackend} onChange={(ev) => at.setTranscriberBackend(ev.target.value)}>{optionNodes(transcriberBackendOptions(at.language), trOpt)}</select></label>
                                <label>{t.autoTiming.device}<select value={at.transcriberDevice} onChange={(ev) => at.setTranscriberDevice(ev.target.value)}>{optionNodes(DEVICE_OPTIONS, trOpt)}</select></label>
                                <label>{t.autoTiming.modelName}<select value={at.transcriberModel} onChange={(ev) => at.setTranscriberModel(ev.target.value)}>{optionNodes(transcriberModelOptions(at.language, at.transcriberBackend), trOpt)}</select></label>
                                <label>{t.autoTiming.computeType}<select value={at.transcriberComputeType} onChange={(ev) => at.setTranscriberComputeType(ev.target.value)} disabled={!at.transcriberIsFasterWhisper}>{optionNodes(COMPUTE_TYPE_OPTIONS, trOpt)}</select></label>
                                <label>{t.autoTiming.batchSize}<input inputMode="numeric" placeholder="8" value={at.transcriberBatchSize} onChange={(ev) => at.setTranscriberBatchSize(ev.target.value)} disabled={!at.transcriberIsFasterWhisper} /></label>
                                <label>{t.autoTiming.vadFilter}<select value={at.vadFilter} onChange={(ev) => at.setVadFilter(ev.target.value)}>{optionNodes(VAD_FILTER_OPTIONS, trOpt)}</select></label>
                            </div>

                            <div className="roller-section-title">{t.autoTiming.parser}</div>
                            <div className="roller-form"><label>{t.autoTiming.lyricsEncoding}<select value={at.parserEncoding} onChange={(ev) => at.setParserEncoding(ev.target.value)}>{optionNodes(PARSER_ENCODING_OPTIONS, trOpt)}</select></label></div>

                            <div className="roller-section-title">{t.autoTiming.aligner}</div>
                            <div className="roller-form two-col"><label>{t.autoTiming.backend}<select value={at.alignerBackend} onChange={(ev) => at.setAlignerBackend(ev.target.value)}>{optionNodes(ALIGNER_BACKEND_OPTIONS, trOpt)}</select></label><label>{t.autoTiming.minGap}<input inputMode="decimal" placeholder="0.5" value={at.alignerMinGap} onChange={(ev) => at.setAlignerMinGap(ev.target.value)} /></label></div>

                            <div className="roller-section-title">{t.autoTiming.writer}</div>
                            <div className="roller-form two-col"><label>{t.autoTiming.byTag}<input placeholder="RollingPebble" value={at.writerByTag} onChange={(ev) => at.setWriterByTag(ev.target.value)} /></label><label>{t.autoTiming.assKaraokeTag}<select value={at.writerKaraokeTag} onChange={(ev) => at.setWriterKaraokeTag(ev.target.value as KaraokeTag)} disabled={!at.writerIsAss}>{optionNodes(KARAOKE_TAG_OPTIONS, trOpt)}</select></label></div>
                        </details>
                    </div>
                </section>

                <section className="settings-section">
                    <h3>{t.upload.title}</h3>
                    <label className="settings-check-row"><input type="checkbox" checked={uploadDerivePlain} disabled={busy} onChange={(ev) => { setUploadDerivePlain(ev.currentTarget.checked); void savePatch({ upload_derive_plain_from_synced: ev.currentTarget.checked }); }} /><span><b>{t.upload.derivePlain}</b><small>{t.upload.derivePlainDesc}</small></span></label>
                </section>


                <section className="settings-section storage-cleanup-section">
                    <h3>{t.storage.title}</h3>
                    <div className="storage-overview">
                        <div className="storage-total-card">
                            <b>{t.storage.totalData}</b>
                            <strong>{formatBytes(storageUsage?.total_bytes)}</strong>
                            <small>{storageUsage?.data_dir || runtime?.data_dir || "loading"}</small>
                        </div>
                        <div className="storage-category-grid">
                            {(storageUsage?.categories || []).map((category) => (
                                <div className="storage-category-card" key={category.id} title={tl(category.description)}>
                                    <b>{tl(category.label)}</b>
                                    <span>{formatBytes(category.bytes)}</span>
                                    <small>{category.file_count ? u.filesUnit.replace("{n}", String(category.file_count)) : tl(category.description)}</small>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="roller-actions storage-actions storage-root-actions">
                        <button type="button" onClick={() => void api.openStorageFolder()}>{t.common.openFolder}</button>
                        <button type="button" disabled={storageBusy || !safeCleanupAvailable} onClick={() => void runStorageCleanupDirect(["safe"])}>{t.storage.safeCleanup}</button>
                    </div>

                    <details open>
                        <summary>{t.storage.projects}</summary>
                        <div className="storage-project-toolbar">
                            <div className="roller-form storage-project-controls">
                                <label>{t.storage.olderThan}<select value={storageOlderThanDays} onChange={(ev) => setStorageOlderThanDays(ev.target.value)}><option value="0">{t.storage.all}</option><option value="1">{t.storage.oneDay}</option><option value="7">{t.storage.sevenDays}</option><option value="30">{t.storage.thirtyDays}</option></select></label>
                            </div>
                            <div className="roller-actions storage-actions">
                                <button type="button" disabled={storageBusy || allIntermediateProjectIds.length === 0} onClick={() => void runStorageCleanupDirect(["clear_intermediate"], { projectIds: allIntermediateProjectIds })}>{t.storage.clearIntermediates}</button>
                                <button className="danger-action" type="button" disabled={storageBusy || allStorageProjectIds.length === 0} onClick={() => void runStorageCleanupDirect(["delete_projects"], { projectIds: allStorageProjectIds, confirmation: `Delete ${allStorageProjectIds.length} displayed project${allStorageProjectIds.length === 1 ? "" : "s"}?` })}>{t.common.delete}</button>
                            </div>
                        </div>
                        <div className="storage-project-list">
                            {storageProjects.length === 0 && <p className="roller-message subtle">{t.storage.noProjects}</p>}
                            {storageProjects.map((project) => (
                                <div className={`storage-project-row ${project.active ? "blocked" : ""}`} key={project.project_id}>
                                    <div className="storage-project-main">
                                        <b>{project.title || project.project_id}</b>
                                        <small>{project.artist || "Unknown Artist"} · {project.project_id}{project.active ? " · Running" : ""}</small>
                                        <div className="storage-project-breakdown">
                                            <span>{tl("Total")} {formatBytes(project.total_bytes)}</span>
                                            <span>{tl("Intermediate")} {formatBytes(project.intermediate_bytes)}</span>
                                        </div>
                                    </div>
                                    <div className="storage-project-actions">
                                        <button type="button" disabled={storageBusy || project.active || !project.has_intermediate} onClick={() => void runStorageCleanupDirect(["clear_intermediate"], { projectIds: [project.project_id] })}>{t.storage.clearIntermediates}</button>
                                        <button className="danger-action" type="button" disabled={storageBusy || project.active} onClick={() => void runStorageCleanupDirect(["delete_projects"], { projectIds: [project.project_id], confirmation: "Delete this project?" })}>{t.common.delete}</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </details>

                    <details>
                        <summary>{t.storage.models}</summary>
                        <div className="roller-actions storage-actions">
                            <button className="danger-action" type="button" disabled={storageBusy || storageModels.length === 0 || storageModels.some((item) => item.active)} onClick={() => void runStorageCleanupDirect(["delete_model_items"], { modelIds: storageModels.map((item) => item.id), confirmation: `Delete all ${storageModels.length} model cache item${storageModels.length === 1 ? "" : "s"}?` })}>{t.storage.deleteAllModels}</button>
                        </div>
                        <div className="storage-item-list">
                            {storageModels.length === 0 && <p className="roller-message subtle">{t.storage.noModels}</p>}
                            {storageModels.map((item) => (
                                <div className="storage-item-row" key={item.id}>
                                    <div className="storage-project-main">
                                        <b>{tl(item.label)}</b>
                                        <small>{item.provider || "Model"}{item.backend ? ` · ${item.backend}` : ""} · {item.relative_path}</small>
                                        <div className="storage-project-breakdown">
                                            <span>{formatBytes(item.bytes)}</span>
                                            <span>{u.filesUnit.replace("{n}", String(item.file_count))}</span>
                                        </div>
                                    </div>
                                    <div className="storage-project-actions">
                                        <button type="button" disabled={storageBusy} onClick={() => void api.openModelFolder(item.id)}>{t.common.openFolder}</button>
                                        <button className="danger-action" type="button" disabled={storageBusy || item.active} onClick={() => void runStorageCleanupDirect(["delete_model_items"], { modelIds: [item.id], confirmation: `Delete model cache ${tl(item.label)}?` })}>{t.common.delete}</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </details>

                    <details>
                        <summary>{t.storage.runtimeEnvs}</summary>
                        <div className="roller-actions storage-actions">
                            <button className="danger-action" type="button" disabled={storageBusy || storageRuntimes.every((item) => !item.removable)} onClick={() => void runStorageCleanupDirect(["clean_runtime_envs"], { runtimeIds: storageRuntimes.filter((item) => item.removable).map((item) => item.runtime_id), confirmation: "Delete all inactive runtimes?" })}>{t.storage.deleteInactiveRuntimes}</button>
                        </div>
                        <div className="storage-item-list">
                            {storageRuntimes.length === 0 && <p className="roller-message subtle">{t.storage.noRuntimes}</p>}
                            {storageRuntimes.map((item) => (
                                <div className="storage-item-row" key={item.runtime_id}>
                                    <div className="storage-project-main">
                                        <b>{item.runtime_id}{item.active ? " · Active" : ""}</b>
                                        <small>{item.profile || "profile"} · {item.status}{item.pyroller_version ? ` · py-roller ${item.pyroller_version}` : ""}{item.python_version ? ` · Python ${item.python_version}` : ""}</small>
                                        <div className="storage-project-breakdown">
                                            <span>{formatBytes(item.bytes)}</span>
                                            <span>{u.filesUnit.replace("{n}", String(item.file_count))}</span>
                                        </div>
                                    </div>
                                    <div className="storage-project-actions">
                                        <button type="button" disabled={storageBusy} onClick={() => void api.openRuntimeFolder(item.runtime_id)}>{t.common.openFolder}</button>
                                        <button className="danger-action" type="button" disabled={storageBusy || !item.removable} onClick={() => void runStorageCleanupDirect(["clean_runtime_envs"], { runtimeIds: [item.runtime_id], confirmation: `Delete runtime ${item.runtime_id}?` })}>{t.common.delete}</button>
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
                                        <button type="button" disabled={storageBusy} onClick={() => void api.openOtherFolder(item.relative_path)}>{t.common.openFolder}</button>
                                        {item.removable && <button className="danger-action" type="button" disabled={storageBusy} onClick={() => void runStorageCleanupDirect(["delete_other_items"], { otherPaths: [item.relative_path], confirmation: `Delete ${tl(item.label)}?` })}>{t.common.delete}</button>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </details>

                    <details>
                        <summary>{t.storage.browserStorage}</summary>
                        <div className="roller-actions storage-actions">
                            <button type="button" disabled={storageBusy} onClick={() => void clearBrowserState()}>{t.storage.clearBrowserState}</button>
                        </div>
                    </details>

                </section>

                {message && <p className={`roller-message ${messageType}${messageFading ? " fading" : ""}`}>{message}</p>}
            </aside>
        </div>
    );

};
