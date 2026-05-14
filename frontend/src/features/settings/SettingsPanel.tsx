import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AutoRollerRuntime, type JobModel, type StorageCleanupTarget, type StorageUsage } from "../../shared/api.js";
import { notifySettingsUpdated } from "../../shared/settingsEvents.js";
import { requestEditorLrcCleanup } from "../../shared/editorCleanupEvents.js";
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
    WRITER_OPTIONS,
    defaultModelFor,
    isFasterWhisper,
    normalizeStages,
    normalizeTranscriberBackend,
    normalizeTranscriberDevice,
    transcriberBackendOptions,
    transcriberModelOptions,
    type Cleanup,
    type HfXet,
    type KaraokeTag,
    type Language,
    type LocalOnly,
    type LogLevel,
    type Repetition,
    type Spacing,
} from "../roller/autoTimingOptions.js";

type Profile = "auto" | "cpu" | "cu124";

function textFromOptionalNumber(value?: number | null): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function optionalNumber(value: string): number | null {
    const text = value.trim();
    if (!text) return null;
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("Numeric settings must be positive numbers.");
    }
    return parsed;
}

function optionalPositiveInt(value: string): number | null {
    const text = value.trim();
    if (!text) return null;
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("Integer settings must be positive numbers.");
    }
    return Math.max(1, Math.round(parsed));
}

function formatDateTime(value?: string | null): string {
    if (!value) return "not available";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function secondsSince(value?: string | null): number | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
}

function formatDuration(seconds: number | null): string {
    if (seconds === null) return "unknown";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function isOlderThanDays(value: string | null | undefined, days: number): boolean {
    if (days <= 0) return true;
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    return Date.now() - date.getTime() >= days * 86400 * 1000;
}


function formatBytes(bytes?: number | null): string {
    const value = typeof bytes === "number" && Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
    if (value < 1024) return `${value} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let size = value / 1024;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
    }
    return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[index]}`;
}

type RuntimeStepStatus = "pending" | "running" | "done" | "failed";

type RuntimeStep = {
    key: string;
    label: string;
    status: RuntimeStepStatus;
    message: string;
};

const INSTALL_STEP_LABELS: Record<string, string> = {
    upgrade_packaging_tools: "Upgrade packaging tools",
    uninstall_existing_torch: "Remove existing Torch packages",
    install_torch_stack: "Install Torch stack",
    install_audio_requirements: "Install audio requirements",
    validation: "Validate runtime profile",
    doctor: "Runtime check",
};

function titleFromKey(key: string): string {
    return INSTALL_STEP_LABELS[key] || key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
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

function runtimeJobTitle(job: JobModel): string {
    if (job.kind === "auto-roller-runtime-install") return "Create / Repair Runtime";
    if (job.kind === "auto-roller-doctor") return "Runtime Check";
    return job.kind;
}

function runtimeCompletionMessage(job: JobModel): string {
    const result = job.result || {};
    if (job.kind === "auto-roller-runtime-install" && typeof result.runtime_id === "string") {
        return `Runtime ready: ${result.runtime_id}`;
    }
    if (job.kind === "auto-roller-doctor") return "";
    return job.progress?.message || "Task complete.";
}

const RuntimeJobTerminal: React.FC<{ job: JobModel; elapsed: number | null; lastOutput: number | null }> = ({ job, elapsed, lastOutput }) => {
    const running = ["queued", "running"].includes(job.status);
    const steps = buildRuntimeSteps(job);
    const checks = doctorCheckSteps(job);
    const rawLog = job.logs.join("\n") || job.command.join(" ");
    return (
        <div className="settings-job-terminal">
            <div className="settings-job-header">
                <div>
                    <b>{runtimeJobTitle(job)}</b>
                    <small>{job.job_id} · {job.status}</small>
                </div>
                {job.status === "succeeded" && <span className="runtime-status-pill ok">Succeeded</span>}
                {job.status === "failed" && <span className="runtime-status-pill fail">Failed</span>}
                {running && <span className="runtime-status-pill running">Running</span>}
            </div>
            <div className="roller-kv compact">
                <b>PID</b><span>{job.pid || "pending"}</span>
                <b>Elapsed</b><span>{formatDuration(elapsed)}</span>
                <b>Last output</b><span>{formatDuration(lastOutput)} ago</span>
                <b>Exit code</b><span>{job.return_code ?? "n/a"}</span>
            </div>
            {job.status === "succeeded" && runtimeCompletionMessage(job) && <p className="roller-message success">{runtimeCompletionMessage(job)}</p>}
            {job.status === "failed" && <p className="roller-message error">{job.error || "Runtime task failed."}</p>}
            {running && lastOutput !== null && lastOutput > 30 && <p className="roller-message subtle">No output recently. pip may still be downloading, resolving, or installing packages. The process is still running.</p>}
            {steps.length > 0 && (
                <ol className="runtime-step-list">
                    {steps.map((step) => (
                        <li key={step.key} className={`runtime-step ${step.status}`}>
                            <span className="runtime-step-dot" />
                            <span><b>{step.label}</b>{step.message && <small>{step.message}</small>}</span>
                        </li>
                    ))}
                </ol>
            )}
            {checks.length > 0 && (
                <ol className="runtime-step-list">
                    {checks.map((step) => (
                        <li key={step.key} className={`runtime-step ${step.status}`}>
                            <span className="runtime-step-dot" />
                            <span><b>{step.label}</b>{step.message && <small>{step.message}</small>}</span>
                        </li>
                    ))}
                </ol>
            )}
            <details className="runtime-raw-log">
                <summary>Raw log</summary>
                <pre className="roller-log">{rawLog}</pre>
            </details>
        </div>
    );
};


const optionNodes = (options: { value: string; label: string; disabled?: boolean }[]) =>
    options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>);

export const SettingsPanel: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const [runtime, setRuntime] = useState<AutoRollerRuntime | null>(null);
    const [profile, setProfile] = useState<Profile>("auto");
    const [autoFillLibrary, setAutoFillLibrary] = useState(true);
    const [editorWriteMetadataTags, setEditorWriteMetadataTags] = useState(true);
    const [uploadDerivePlain, setUploadDerivePlain] = useState(true);
    const [recentProjectsLimit, setRecentProjectsLimit] = useState("8");
    const [cleanupBusy, setCleanupBusy] = useState(false);
    const [autoTimingLoaded, setAutoTimingLoaded] = useState(false);
    const skipAutoTimingSave = useRef(true);
    const autoTimingSaveTimer = useRef<number | null>(null);

    const [defaultLanguage, setDefaultLanguage] = useState<Language>("zh");
    const [defaultStages, setDefaultStages] = useState("t,p,a,w");
    const [defaultWriterBackend, setDefaultWriterBackend] = useState("lrc_ms");
    const [defaultWriterSpacing, setDefaultWriterSpacing] = useState<Spacing>("keep");
    const [defaultCleanup, setDefaultCleanup] = useState<Cleanup>("never");
    const [defaultLogLevel, setDefaultLogLevel] = useState<LogLevel>("INFO");

    const [splitterBackend, setSplitterBackend] = useState("demucs");
    const [splitterModel, setSplitterModel] = useState("htdemucs");
    const [splitterDevice, setSplitterDevice] = useState("");
    const [splitterJobs, setSplitterJobs] = useState("");
    const [splitterOverlap, setSplitterOverlap] = useState("");
    const [splitterSegment, setSplitterSegment] = useState("");
    const [filterChain, setFilterChain] = useState("");

    const [transcriberBackend, setTranscriberBackend] = useState("faster_whisper");
    const [transcriberDevice, setTranscriberDevice] = useState("cpu");
    const [transcriberModelName, setTranscriberModelName] = useState("large-v2");
    const [modelStore, setModelStore] = useState("");
    const [transcriberComputeType, setTranscriberComputeType] = useState("int8");
    const [transcriberBatchSize, setTranscriberBatchSize] = useState("8");
    const [defaultLocalOnly, setDefaultLocalOnly] = useState<LocalOnly>("off");
    const [hfXet, setHfXet] = useState<HfXet>("auto");
    const [hfProxy, setHfProxy] = useState("");
    const [hfEtagTimeout, setHfEtagTimeout] = useState("");
    const [hfDownloadTimeout, setHfDownloadTimeout] = useState("");
    const [hfMaxWorkers, setHfMaxWorkers] = useState("");

    const [parserEncoding, setParserEncoding] = useState("auto");
    const [alignerBackend, setAlignerBackend] = useState("global_dp_v1");
    const [alignerMinGap, setAlignerMinGap] = useState("0.5");
    const [alignerRepetition, setAlignerRepetition] = useState<Repetition>("none");
    const [writerByTag, setWriterByTag] = useState("LRC Roller");
    const [writerKaraokeTag, setWriterKaraokeTag] = useState<KaraokeTag>("kf");

    const [job, setJob] = useState<JobModel | null>(null);
    const [message, setMessage] = useState("");
    const [runtimeError, setRuntimeError] = useState("");
    const [busy, setBusy] = useState(false);

    const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
    const [storageOlderThanDays, setStorageOlderThanDays] = useState("1");
    const [storageBusy, setStorageBusy] = useState(false);
    const [storageMessage, setStorageMessage] = useState("");
    const [storageError, setStorageError] = useState("");

    const refresh = useCallback(async () => {
        try {
            setAutoTimingLoaded(false);
            const data = await api.autoRollerRuntime();
            const settings = data.settings;
            const language = settings.auto_timing_default_language || "zh";
            const backend = normalizeTranscriberBackend(language, settings.auto_timing_transcriber_backend || "faster_whisper");
            setRuntime(data);
            setProfile(settings.auto_roller_profile);
            setAutoFillLibrary(settings.auto_fill_lyrics_library_from_project_metadata);
            setEditorWriteMetadataTags(settings.editor_write_metadata_tags);
            setUploadDerivePlain(settings.upload_derive_plain_from_synced);
            setRecentProjectsLimit(String(settings.recent_projects_limit || 8));

            setDefaultLanguage(language);
            setDefaultStages(normalizeStages(settings.auto_timing_default_stages || "t,p,a,w"));
            setDefaultWriterBackend(settings.auto_timing_default_writer_backend || "lrc_ms");
            setDefaultWriterSpacing(settings.auto_timing_default_writer_spacing || "keep");
            setDefaultCleanup(settings.auto_timing_default_cleanup || "never");
            setDefaultLogLevel(settings.auto_timing_default_log_level || "INFO");

            setSplitterBackend(settings.auto_timing_splitter_backend || "demucs");
            setSplitterModel(settings.auto_timing_splitter_demucs_model || "htdemucs");
            setSplitterDevice(settings.auto_timing_splitter_demucs_device || "");
            setSplitterJobs(textFromOptionalNumber(settings.auto_timing_splitter_demucs_jobs));
            setSplitterOverlap(textFromOptionalNumber(settings.auto_timing_splitter_demucs_overlap));
            setSplitterSegment(textFromOptionalNumber(settings.auto_timing_splitter_demucs_segment));
            setFilterChain(settings.auto_timing_filter_chain || "");

            setTranscriberBackend(backend);
            setTranscriberDevice(normalizeTranscriberDevice(settings.auto_timing_transcriber_device || "cpu"));
            setTranscriberModelName(settings.auto_timing_transcriber_model_name || defaultModelFor(language, backend));
            setModelStore(settings.auto_timing_model_store || "");
            setTranscriberComputeType(settings.auto_timing_transcriber_compute_type || "int8");
            setTranscriberBatchSize(textFromOptionalNumber(settings.auto_timing_transcriber_batch_size) || "8");
            setDefaultLocalOnly(settings.auto_timing_local_files_only_default ? "on" : "off");
            setHfXet(settings.auto_timing_hf_xet || "auto");
            setHfProxy(settings.auto_timing_hf_proxy || "");
            setHfEtagTimeout(textFromOptionalNumber(settings.auto_timing_hf_etag_timeout));
            setHfDownloadTimeout(textFromOptionalNumber(settings.auto_timing_hf_download_timeout));
            setHfMaxWorkers(textFromOptionalNumber(settings.auto_timing_hf_max_workers));

            setParserEncoding(settings.auto_timing_parser_lyrics_encoding || "auto");
            setAlignerBackend(settings.auto_timing_aligner_backend || "global_dp_v1");
            setAlignerMinGap(textFromOptionalNumber(settings.auto_timing_aligner_min_gap) || "0.5");
            setAlignerRepetition(settings.auto_timing_aligner_repetition || "none");
            setWriterByTag(settings.auto_timing_writer_by_tag === "py-roller" ? "LRC Roller" : (settings.auto_timing_writer_by_tag || "LRC Roller"));
            setWriterKaraokeTag(settings.auto_timing_writer_ass_karaoke_tag_type || "kf");
            skipAutoTimingSave.current = true;
            window.setTimeout(() => setAutoTimingLoaded(true), 0);
        } catch (error) {
            setMessage((error as Error).message);
        }
    }, []);

    const refreshStorage = useCallback(async () => {
        try {
            const usage = await api.storageUsage();
            setStorageUsage(usage);
        } catch (error) {
            setStorageError((error as Error).message);
        }
    }, []);

    useEffect(() => {
        if (open) {
            void refresh();
            void refreshStorage();
        }
    }, [open, refresh, refreshStorage]);

    useEffect(() => {
        const normalized = normalizeTranscriberBackend(defaultLanguage, transcriberBackend);
        if (normalized !== transcriberBackend) {
            setTranscriberBackend(normalized);
            setTranscriberModelName(defaultModelFor(defaultLanguage, normalized));
            return;
        }
        const allowedModels = transcriberModelOptions(defaultLanguage, normalized).map((item) => item.value);
        if (!allowedModels.includes(transcriberModelName)) {
            setTranscriberModelName(defaultModelFor(defaultLanguage, normalized));
        }
    }, [defaultLanguage, transcriberBackend, transcriberModelName]);

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
                setMessage((error as Error).message);
            }
        }, 1400);
        return () => window.clearInterval(timer);
    }, [job, refresh]);

    const transcriberIsFasterWhisper = isFasterWhisper(transcriberBackend);
    const writerIsAss = defaultWriterBackend === "ass_karaoke";
    const runtimeJobRunning = Boolean(job && ["queued", "running"].includes(job.status));
    const runtimeJobElapsed = secondsSince(job?.started_at);
    const runtimeJobLastOutput = secondsSince(job?.last_output_at || job?.started_at);

    const savePatch = async (payload: Record<string, unknown>, success = "Settings saved.") => {
        setBusy(true);
        setMessage("Saving settings...");
        try {
            await api.updateSettings(payload);
            notifySettingsUpdated();
            await refresh();
            setMessage(success);
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const saveProfile = async (value: Profile) => {
        setProfile(value);
        await savePatch({ auto_roller_profile: value });
    };

    const resetDefaults = async () => {
        if (!window.confirm("Reset all settings to their defaults? Projects, models, runtimes, and storage files are not affected.")) return;
        setBusy(true);
        setMessage("Resetting settings...");
        try {
            await api.resetSettingsDefaults();
            notifySettingsUpdated();
            await refresh();
            setMessage("Settings reset to defaults.");
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const saveAutoTimingDefaults = useCallback(async (success = "Auto Timing settings saved automatically.") => {
        try {
            await api.updateSettings({
                auto_timing_default_language: defaultLanguage,
                auto_timing_default_stages: defaultStages,
                auto_timing_default_writer_backend: defaultWriterBackend,
                auto_timing_default_writer_spacing: defaultWriterSpacing,
                auto_timing_default_cleanup: defaultCleanup,
                auto_timing_default_log_level: defaultLogLevel,

                auto_timing_splitter_backend: splitterBackend,
                auto_timing_splitter_demucs_model: splitterModel,
                auto_timing_splitter_demucs_device: splitterDevice,
                auto_timing_splitter_demucs_jobs: optionalPositiveInt(splitterJobs),
                auto_timing_splitter_demucs_overlap: optionalNumber(splitterOverlap),
                auto_timing_splitter_demucs_segment: optionalNumber(splitterSegment),
                auto_timing_filter_chain: filterChain,

                auto_timing_transcriber_backend: transcriberBackend,
                auto_timing_transcriber_device: transcriberDevice,
                auto_timing_transcriber_model_name: transcriberModelName,
                auto_timing_model_store: modelStore.trim(),
                auto_timing_transcriber_compute_type: transcriberIsFasterWhisper ? transcriberComputeType : "",
                auto_timing_transcriber_batch_size: transcriberIsFasterWhisper ? optionalPositiveInt(transcriberBatchSize) : null,
                auto_timing_local_files_only_default: defaultLocalOnly === "on",
                auto_timing_hf_xet: hfXet,
                auto_timing_hf_proxy: hfProxy.trim(),
                auto_timing_hf_etag_timeout: optionalPositiveInt(hfEtagTimeout),
                auto_timing_hf_download_timeout: optionalPositiveInt(hfDownloadTimeout),
                auto_timing_hf_max_workers: optionalPositiveInt(hfMaxWorkers),

                auto_timing_parser_lyrics_encoding: parserEncoding,
                auto_timing_aligner_backend: alignerBackend,
                auto_timing_aligner_min_gap: optionalNumber(alignerMinGap),
                auto_timing_aligner_repetition: alignerRepetition,
                auto_timing_writer_by_tag: writerByTag.trim(),
                auto_timing_writer_ass_karaoke_tag_type: writerIsAss ? writerKaraokeTag : "",
            });
            notifySettingsUpdated();
            setMessage(success);
        } catch (error) {
            setMessage((error as Error).message);
        }
    }, [alignerBackend, alignerMinGap, alignerRepetition, defaultCleanup, defaultLanguage, defaultLocalOnly, defaultLogLevel, defaultStages, defaultWriterBackend, defaultWriterSpacing, filterChain, hfDownloadTimeout, hfEtagTimeout, hfMaxWorkers, hfProxy, hfXet, modelStore, parserEncoding, splitterBackend, splitterDevice, splitterJobs, splitterModel, splitterOverlap, splitterSegment, transcriberBackend, transcriberBatchSize, transcriberComputeType, transcriberDevice, transcriberIsFasterWhisper, transcriberModelName, writerByTag, writerIsAss, writerKaraokeTag]);

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

    const requestCleanup = () => {
        setCleanupBusy(true);
        setMessage("Cleaning current editor lyrics...");
        requestEditorLrcCleanup({
            removeTranslations: true,
            onResult: (result) => {
                setCleanupBusy(false);
                setMessage(result.message);
            },
        });
    };


    const browseModelStore = async () => {
        setBusy(true);
        setMessage("Opening folder picker...");
        try {
            const result = await api.selectLocalPath({
                mode: "directory",
                title: "Select model store folder",
                initial_path: modelStore || runtime?.model_store || null,
            });
            if (!result.canceled && result.path) {
                setModelStore(result.path);
                setMessage("Model store selected.");
            } else {
                setMessage("Folder selection canceled.");
            }
        } catch (error) {
            setMessage((error as Error).message);
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
        await navigator.clipboard?.writeText(text);
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
        options: { projectIds?: string[]; modelIds?: string[]; runtimeIds?: string[]; confirmation?: string } = {},
    ) => {
        const projectIds = options.projectIds || [];
        const modelIds = options.modelIds || [];
        const runtimeIds = options.runtimeIds || [];
        if (projectIds.length === 0 && targets.some((target) => target === "delete_projects" || target === "clear_intermediate")) {
            setStorageMessage("No matching projects to clean.");
            return;
        }
        if (modelIds.length === 0 && targets.includes("delete_model_items")) {
            setStorageMessage("No matching models to clean.");
            return;
        }
        if (runtimeIds.length === 0 && targets.includes("clean_runtime_envs")) {
            setStorageMessage("No matching runtimes to delete.");
            return;
        }
        if (options.confirmation && !window.confirm(options.confirmation)) {
            return;
        }
        setStorageBusy(true);
        setStorageError("");
        setStorageMessage("Cleaning files...");
        try {
            const plan = await api.storageCleanupPreview({
                targets,
                project_ids: projectIds,
                model_ids: modelIds,
                runtime_ids: runtimeIds,
                older_than_days: 0,
            });
            const result = await api.storageCleanupRun({
                plan_id: plan.plan_id,
                entry_ids: null,
            });
            if (result.usage) setStorageUsage(result.usage);
            setStorageMessage(`Deleted ${result.deleted_count} entries and reclaimed ${formatBytes(result.deleted_bytes)}${result.failed.length ? `; ${result.failed.length} failed` : ""}.`);
        } catch (error) {
            setStorageError((error as Error).message);
        } finally {
            setStorageBusy(false);
        }
    };

    const clearBrowserState = async () => {
        if (!window.confirm("Clear local UI state and legacy lrc-maker keys? Project files are not affected.")) return;
        const localKeys = [
            "lrc-roller-hidden-recent-projects",
            "lrc-maker-lyric",
            "lrc-maker-preferences",
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
            await Promise.all(names.filter((name) => name.startsWith("lrc-roller")).map((name) => caches.delete(name)));
        }
        setStorageMessage("Browser state cleared.");
    };

    const projectOlderThanDays = Number.isFinite(Number(storageOlderThanDays)) ? Math.max(0, Math.round(Number(storageOlderThanDays))) : 0;
    const storageProjects = (storageUsage?.projects || []).filter((project) => isOlderThanDays(project.updated_at, projectOlderThanDays));
    const allStorageProjectIds = storageProjects.filter((project) => !project.active).map((project) => project.project_id);
    const allIntermediateProjectIds = storageProjects.filter((project) => !project.active && project.has_intermediate).map((project) => project.project_id);
    const storageModels = storageUsage?.models || [];
    const storageRuntimes = storageUsage?.runtimes || [];
    const storageOtherItems = storageUsage?.other_items || [];

    if (!open) return null;

    return (
        <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings">
            <button className="settings-backdrop" type="button" onClick={onClose} aria-label="Close settings" />
            <aside className="settings-drawer">
                <div className="settings-header">
                    <h2>Settings</h2>
                    <button type="button" onClick={onClose}>Close</button>
                </div>

                <section className="settings-section">
                    <h3>General</h3>
                    <div className="roller-kv">
                        <b>App mode</b><span>Local WebUI</span>
                        <b>Backend</b><span>http://127.0.0.1:6789</span>
                        <b>Frontend</b><span>http://127.0.0.1:5173</span>
                        <b>Data dir</b><span>{runtime?.data_dir || "loading"}</span>
                    </div>
                    <div className="roller-actions settings-general-actions">
                        <button className="danger-action" type="button" disabled={busy} onClick={() => void resetDefaults()}>Reset Defaults</button>
                    </div>
                </section>

                <section className="settings-section">
                    <h3>Project</h3>
                    <div className="roller-form two-col">
                        <label>Recent projects shown<input inputMode="numeric" value={recentProjectsLimit} onChange={(ev) => setRecentProjectsLimit(ev.target.value)} onBlur={() => { const parsed = Number(recentProjectsLimit); const value = Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.round(parsed)) : 8; setRecentProjectsLimit(String(value)); void savePatch({ recent_projects_limit: value }, "Recent projects limit saved."); }} /></label>
                    </div>
                </section>

                <section className="settings-section">
                    <h3>Import Lyrics</h3>
                    <label className="settings-check-row"><input type="checkbox" checked={autoFillLibrary} disabled={busy} onChange={(ev) => { setAutoFillLibrary(ev.currentTarget.checked); void savePatch({ auto_fill_lyrics_library_from_project_metadata: ev.currentTarget.checked }); }} /><span><b>Auto-fill from project metadata</b><small>Fill import fields from audio tags when a project is loaded.</small></span></label>
                </section>

                <section className="settings-section">
                    <h3>Synchronizer &amp; Editor</h3>
                    <label className="settings-check-row"><input type="checkbox" checked={editorWriteMetadataTags} disabled={busy} onChange={(ev) => { setEditorWriteMetadataTags(ev.currentTarget.checked); void savePatch({ editor_write_metadata_tags: ev.currentTarget.checked }, "Editor metadata tag setting saved."); }} /><span><b>Write metadata tags into LRC text</b><small>Include [ti:], [ar:], [al:], and other metadata lines in the text editor and exported LRC text.</small></span></label>
                    <div className="settings-inline-action settings-cleanup-action">
                        <span><b>LRC cleanup</b><small>Remove detected same-timestamp translated duplicate lines from the current editor contents.</small></span>
                        <button type="button" disabled={cleanupBusy} onClick={requestCleanup}>Apply Cleanup</button>
                    </div>
                </section>

                <section className="settings-section">
                    <h3>Auto Timing</h3>
                    <div className="settings-subsection">
                        <h4>Runtime</h4>
                        <div className="roller-kv">
                            <b>Mode</b><span>Isolated runtime</span>
                            <b>Engine</b><span>{runtime?.engine || "py-roller"}</span>
                            <b>Status</b><span>{runtime?.runtime_status || "loading"}</span>
                            <b>Version</b><span>{runtime?.version || "not installed"}</span>
                            <b>Runtime ID</b><span>{runtime?.runtime_id || "not created"}</span>
                            <b>Runtime Python</b><span>{runtime?.runtime_python || "not created"}</span>
                            <b>Runtime folder</b><span>{runtime?.runtime_root || "not created"}</span>
                            <b>Source</b><span>{runtime?.runtime_source || "PyPI compatible package"}</span>
                            <b>Required py-roller</b><span>{runtime?.runtime_requirement || "py-roller>=0.5.6,<0.6"}</span>
                            <b>Effective Transcriber Model Store</b><span>{modelStore || runtime?.model_store || "unknown"}</span>
                            <b>Last check</b><span>{runtime?.settings.last_doctor_status || "not run"} {runtime?.settings.last_doctor_at ? `· ${runtime.settings.last_doctor_at}` : ""}</span>
                            <b>Last install</b><span>{runtime?.settings.last_install_status || runtime?.settings.last_install_profile || "not run"} {runtime?.settings.last_install_at ? `· ${runtime.settings.last_install_at}` : ""}</span>
                        </div>
                        {runtime?.detail && <p className="roller-message subtle">{runtime.detail}</p>}
                        <div className="roller-form settings-profile-row"><label>Runtime profile<select value={profile} disabled={busy || runtimeJobRunning} onChange={(ev) => void saveProfile(ev.target.value as Profile)}><option value="auto">Auto</option><option value="cpu">CPU only</option><option value="cu124">CUDA 12.4</option></select></label></div>
                        <div className="roller-actions"><button type="button" disabled={busy || runtimeJobRunning} onClick={runDoctor}>Runtime Check</button><button type="button" disabled={busy || runtimeJobRunning} onClick={() => void runInstall()}>Create / Repair Runtime</button>{runtimeJobRunning && <button type="button" disabled={busy} onClick={cancelRuntimeJob}>Cancel</button>}<button type="button" onClick={copyDiagnostics}>Copy Diagnostics</button><button type="button" onClick={refresh}>Refresh Status</button></div>
                        {runtimeError && <p className="roller-message error runtime-local-notice">{runtimeError}</p>}
                        {job && <RuntimeJobTerminal job={job} elapsed={runtimeJobElapsed} lastOutput={runtimeJobLastOutput} />}
                    </div>

                    <div className="settings-subsection">
                        <div className="roller-section-title">Core</div>
                        <div className="roller-form two-col">
                            <label>Language<select value={defaultLanguage} onChange={(ev) => setDefaultLanguage(ev.target.value as Language)}>{optionNodes(LANGUAGE_OPTIONS)}</select></label>
                            <label>Processing preset<select value={defaultStages} onChange={(ev) => setDefaultStages(ev.target.value)}>{optionNodes(STAGE_OPTIONS)}</select></label>
                            <label>Output format<select value={defaultWriterBackend} onChange={(ev) => setDefaultWriterBackend(ev.target.value)}>{optionNodes(WRITER_OPTIONS)}</select></label>
                            <label>Repetition handling<select value={alignerRepetition} onChange={(ev) => setAlignerRepetition(ev.target.value as Repetition)}>{optionNodes(REPETITION_OPTIONS)}</select></label>
                            <label>Spacing<select value={defaultWriterSpacing} onChange={(ev) => setDefaultWriterSpacing(ev.target.value as Spacing)}>{optionNodes(SPACING_OPTIONS)}</select></label>
                            <label>Cleanup policy<select value={defaultCleanup} onChange={(ev) => setDefaultCleanup(ev.target.value as Cleanup)}>{optionNodes(CLEANUP_OPTIONS)}</select></label>
                            <label>Log level<select value={defaultLogLevel} onChange={(ev) => setDefaultLogLevel(ev.target.value as LogLevel)}>{optionNodes(LOG_LEVEL_OPTIONS)}</select></label>
                        </div>

                        <details>
                            <summary>Advanced Parameters</summary>
                            <div className="roller-section-title">Model download</div>
                            <div className="roller-form two-col">
                                <label>HF XET / CAS<select value={hfXet} onChange={(ev) => setHfXet(ev.target.value as HfXet)}>{optionNodes(HF_XET_OPTIONS)}</select></label>
                                <label>Proxy URL<input placeholder="socks5h://127.0.0.1:9909" value={hfProxy} onChange={(ev) => setHfProxy(ev.target.value)} /></label>
                                <label>Metadata timeout<input inputMode="numeric" placeholder="library built-in" value={hfEtagTimeout} onChange={(ev) => setHfEtagTimeout(ev.target.value)} /></label>
                                <label>File download timeout<input inputMode="numeric" placeholder="library built-in" value={hfDownloadTimeout} onChange={(ev) => setHfDownloadTimeout(ev.target.value)} /></label>
                                <label>Max download workers<input inputMode="numeric" placeholder="library built-in" value={hfMaxWorkers} onChange={(ev) => setHfMaxWorkers(ev.target.value)} /></label>
                                <label>Local cache mode<select value={defaultLocalOnly} onChange={(ev) => setDefaultLocalOnly(ev.target.value as LocalOnly)}>{optionNodes(LOCAL_CACHE_OPTIONS)}</select></label>
                            </div>

                            <div className="roller-section-title">Splitter</div>
                            <div className="roller-form two-col">
                                <label>Backend<select value={splitterBackend} onChange={(ev) => setSplitterBackend(ev.target.value)}>{optionNodes(SPLITTER_BACKEND_OPTIONS)}</select></label>
                                <label>Demucs model<select value={splitterModel} onChange={(ev) => setSplitterModel(ev.target.value)}>{optionNodes(DEMUCS_MODEL_OPTIONS)}</select></label>
                                <label>Device<select value={splitterDevice} onChange={(ev) => setSplitterDevice(ev.target.value)}>{optionNodes(DEMUCS_DEVICE_OPTIONS)}</select></label>
                                <label>Jobs<input inputMode="numeric" placeholder="Let Demucs choose" value={splitterJobs} onChange={(ev) => setSplitterJobs(ev.target.value)} /></label>
                                <label>Overlap<input inputMode="decimal" placeholder="Demucs built-in" value={splitterOverlap} onChange={(ev) => setSplitterOverlap(ev.target.value)} /></label>
                                <label>Segment seconds<input inputMode="decimal" placeholder="Demucs built-in" value={splitterSegment} onChange={(ev) => setSplitterSegment(ev.target.value)} /></label>
                            </div>

                            <div className="roller-section-title">Filter</div>
                            <div className="roller-form"><label>Filter chain<select value={filterChain} onChange={(ev) => setFilterChain(ev.target.value)}>{optionNodes(FILTER_CHAIN_OPTIONS)}</select></label></div>

                            <div className="roller-section-title">Transcriber</div>
                            <div className="roller-form two-col">
                                <label>Backend<select value={transcriberBackend} onChange={(ev) => setTranscriberBackend(ev.target.value)}>{optionNodes(transcriberBackendOptions(defaultLanguage))}</select></label>
                                <label>Device<select value={transcriberDevice} onChange={(ev) => setTranscriberDevice(ev.target.value)}>{optionNodes(DEVICE_OPTIONS)}</select></label>
                                <label>Model name<select value={transcriberModelName} onChange={(ev) => setTranscriberModelName(ev.target.value)}>{optionNodes(transcriberModelOptions(defaultLanguage, transcriberBackend))}</select></label>
                                <label className="field-with-browse">Transcriber Model Store<span className="browse-row"><input placeholder={runtime?.model_store || "~/.local/share/lrc-roller/models/transcriber"} value={modelStore} onChange={(ev) => setModelStore(ev.target.value)} /><button type="button" disabled={busy} onClick={browseModelStore}>Browse</button></span></label>
                                <label>Compute type<select value={transcriberComputeType} onChange={(ev) => setTranscriberComputeType(ev.target.value)} disabled={!transcriberIsFasterWhisper}>{optionNodes(COMPUTE_TYPE_OPTIONS)}</select></label>
                                <label>Batch size<input inputMode="numeric" placeholder="8" value={transcriberBatchSize} onChange={(ev) => setTranscriberBatchSize(ev.target.value)} disabled={!transcriberIsFasterWhisper} /></label>
                            </div>

                            <div className="roller-section-title">Parser</div>
                            <div className="roller-form"><label>Lyrics encoding<select value={parserEncoding} onChange={(ev) => setParserEncoding(ev.target.value)}>{optionNodes(PARSER_ENCODING_OPTIONS)}</select></label></div>

                            <div className="roller-section-title">Aligner</div>
                            <div className="roller-form two-col"><label>Backend<select value={alignerBackend} onChange={(ev) => setAlignerBackend(ev.target.value)}>{optionNodes(ALIGNER_BACKEND_OPTIONS)}</select></label><label>Min gap seconds<input inputMode="decimal" placeholder="0.5" value={alignerMinGap} onChange={(ev) => setAlignerMinGap(ev.target.value)} /></label></div>

                            <div className="roller-section-title">Writer</div>
                            <div className="roller-form two-col"><label>BY tag<input placeholder="LRC Roller" value={writerByTag} onChange={(ev) => setWriterByTag(ev.target.value)} /></label><label>ASS karaoke tag<select value={writerKaraokeTag} onChange={(ev) => setWriterKaraokeTag(ev.target.value as KaraokeTag)} disabled={!writerIsAss}>{optionNodes(KARAOKE_TAG_OPTIONS)}</select></label></div>
                        </details>
                    </div>
                </section>

                <section className="settings-section">
                    <h3>Upload Lyrics</h3>
                    <label className="settings-check-row"><input type="checkbox" checked={uploadDerivePlain} disabled={busy} onChange={(ev) => { setUploadDerivePlain(ev.currentTarget.checked); void savePatch({ upload_derive_plain_from_synced: ev.currentTarget.checked }); }} /><span><b>Derive plain lyrics from synced lyrics</b><small>Submit timestamp-stripped plain lyrics when uploading synced LRC.</small></span></label>
                </section>


                <section className="settings-section storage-cleanup-section">
                    <h3>Storage &amp; Cleanup</h3>
                    <div className="storage-overview">
                        <div className="storage-total-card">
                            <b>Total Data</b>
                            <strong>{formatBytes(storageUsage?.total_bytes)}</strong>
                            <small>{storageUsage?.data_dir || runtime?.data_dir || "loading"}</small>
                        </div>
                        <div className="storage-category-grid">
                            {(storageUsage?.categories || []).map((category) => (
                                <div className="storage-category-card" key={category.id} title={category.description}>
                                    <b>{category.label}</b>
                                    <span>{formatBytes(category.bytes)}</span>
                                    <small>{category.file_count ? `${category.file_count} files` : category.description}</small>
                                </div>
                            ))}
                        </div>
                    </div>

                    <details open>
                        <summary>Projects</summary>
                        <div className="roller-form storage-controls">
                            <label>Older Than<select value={storageOlderThanDays} onChange={(ev) => setStorageOlderThanDays(ev.target.value)}><option value="0">All</option><option value="1">1 Day</option><option value="7">7 Days</option><option value="30">30 Days</option></select></label>
                        </div>
                        <div className="roller-actions storage-actions">
                            <button type="button" disabled={storageBusy || allIntermediateProjectIds.length === 0} onClick={() => void runStorageCleanupDirect(["clear_intermediate"], { projectIds: allIntermediateProjectIds })}>Clear All Intermediate</button>
                            <button className="danger-action" type="button" disabled={storageBusy || allStorageProjectIds.length === 0} onClick={() => void runStorageCleanupDirect(["delete_projects"], { projectIds: allStorageProjectIds, confirmation: `Delete all ${allStorageProjectIds.length} displayed project${allStorageProjectIds.length === 1 ? "" : "s"}?` })}>Delete All</button>
                        </div>
                        <div className="storage-project-list">
                            {storageProjects.length === 0 && <p className="roller-message subtle">No projects match this age filter.</p>}
                            {storageProjects.map((project) => (
                                <div className={`storage-project-row ${project.active ? "blocked" : ""}`} key={project.project_id}>
                                    <div className="storage-project-main">
                                        <b>{project.title || project.project_id}</b>
                                        <small>{project.artist || "Unknown Artist"} · {project.project_id}{project.active ? " · Running" : ""}</small>
                                        <div className="storage-project-breakdown">
                                            <span>Total {formatBytes(project.total_bytes)}</span>
                                            <span>Intermediate {formatBytes(project.intermediate_bytes)}</span>
                                        </div>
                                    </div>
                                    <div className="storage-project-actions">
                                        <button type="button" disabled={storageBusy || project.active || !project.has_intermediate} onClick={() => void runStorageCleanupDirect(["clear_intermediate"], { projectIds: [project.project_id] })}>Clear Intermediate</button>
                                        <button className="danger-action" type="button" disabled={storageBusy || project.active} onClick={() => void runStorageCleanupDirect(["delete_projects"], { projectIds: [project.project_id], confirmation: "Delete this project?" })}>Delete</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </details>

                    <details>
                        <summary>Models</summary>
                        <div className="roller-actions storage-actions">
                            <button className="danger-action" type="button" disabled={storageBusy || storageModels.length === 0 || storageModels.some((item) => item.active)} onClick={() => void runStorageCleanupDirect(["delete_model_items"], { modelIds: storageModels.map((item) => item.id), confirmation: `Delete all ${storageModels.length} model cache item${storageModels.length === 1 ? "" : "s"}?` })}>Delete All Models</button>
                        </div>
                        <div className="storage-item-list">
                            {storageModels.length === 0 && <p className="roller-message subtle">No model cache items found.</p>}
                            {storageModels.map((item) => (
                                <div className="storage-item-row" key={item.id}>
                                    <div className="storage-project-main">
                                        <b>{item.label}</b>
                                        <small>{item.provider || "Model"}{item.backend ? ` · ${item.backend}` : ""} · {item.relative_path}</small>
                                        <div className="storage-project-breakdown">
                                            <span>{formatBytes(item.bytes)}</span>
                                            <span>{item.file_count} files</span>
                                        </div>
                                    </div>
                                    <div className="storage-project-actions">
                                        <button type="button" disabled={storageBusy} onClick={() => void api.openModelFolder(item.id)}>Open Folder</button>
                                        <button className="danger-action" type="button" disabled={storageBusy || item.active} onClick={() => void runStorageCleanupDirect(["delete_model_items"], { modelIds: [item.id], confirmation: `Delete model cache ${item.label}?` })}>Delete</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </details>

                    <details>
                        <summary>Runtime Environments</summary>
                        <div className="roller-actions storage-actions">
                            <button className="danger-action" type="button" disabled={storageBusy || storageRuntimes.every((item) => !item.removable)} onClick={() => void runStorageCleanupDirect(["clean_runtime_envs"], { runtimeIds: storageRuntimes.filter((item) => item.removable).map((item) => item.runtime_id), confirmation: "Delete all inactive runtimes?" })}>Delete Inactive Runtimes</button>
                        </div>
                        <div className="storage-item-list">
                            {storageRuntimes.length === 0 && <p className="roller-message subtle">No runtime environments found.</p>}
                            {storageRuntimes.map((item) => (
                                <div className={`storage-item-row ${item.active ? "blocked" : ""}`} key={item.runtime_id}>
                                    <div className="storage-project-main">
                                        <b>{item.runtime_id}{item.active ? " · Active" : ""}</b>
                                        <small>{item.profile || "profile"} · {item.status}{item.pyroller_version ? ` · py-roller ${item.pyroller_version}` : ""}{item.python_version ? ` · Python ${item.python_version}` : ""}</small>
                                        <div className="storage-project-breakdown">
                                            <span>{formatBytes(item.bytes)}</span>
                                            <span>{item.file_count} files</span>
                                        </div>
                                    </div>
                                    <div className="storage-project-actions">
                                        <button type="button" disabled={storageBusy} onClick={() => void api.openRuntimeFolder(item.runtime_id)}>Open Folder</button>
                                        <button className="danger-action" type="button" disabled={storageBusy || !item.removable} onClick={() => void runStorageCleanupDirect(["clean_runtime_envs"], { runtimeIds: [item.runtime_id], confirmation: `Delete runtime ${item.runtime_id}?` })}>Delete</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </details>

                    <details>
                        <summary>Other</summary>
                        <div className="storage-item-list">
                            {storageOtherItems.length === 0 && <p className="roller-message subtle">No unclassified items found.</p>}
                            {storageOtherItems.map((item) => (
                                <div className="storage-item-row" key={item.relative_path}>
                                    <div className="storage-project-main">
                                        <b>{item.label}</b>
                                        <small>{item.relative_path}</small>
                                        <div className="storage-project-breakdown">
                                            <span>{formatBytes(item.bytes)}</span>
                                            <span>{item.file_count} files</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </details>

                    <details>
                        <summary>Browser Storage</summary>
                        <div className="roller-actions storage-actions">
                            <button type="button" disabled={storageBusy} onClick={() => void clearBrowserState()}>Clear Browser State</button>
                        </div>
                    </details>

                    {storageError && <p className="roller-message error">{storageError}</p>}
                    {storageMessage && <p className="roller-message">{storageMessage}</p>}
                </section>

                {message && <p className="roller-message">{message}</p>}
            </aside>
        </div>
    );

};
