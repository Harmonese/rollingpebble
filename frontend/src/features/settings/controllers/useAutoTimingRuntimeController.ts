import { useCallback, useEffect, useRef, useState } from "react";
import type { AutoTimingHook } from "../../../domain/auto-timing/useAutoTimingState.js";
import type { Language } from "../../../languages/index.js";
import { cacheModel, runAutoRollerDoctor, runAutoRollerInstall, upgradeAutoRoller } from "../../../shared/api/autoTiming.js";
import { cancelJob, getJob } from "../../../shared/api/jobs.js";
import { backendMessageText } from "../../../shared/api/request.js";
import type { AutoRollerRuntime, JobModel } from "../../../shared/api/types.js";
import { secondsSince } from "../../../shared/format.js";
import { optionalPositiveIntValue } from "../../../shared/numbers.js";
import { notifySettingsUpdated } from "../../../shared/settingsEvents.js";
import { updateSettings } from "../../../shared/api/settings.js";
import { toastPubSub } from "../../../ui/Toast.js";
import type { Profile } from "../sections/types.js";
import { settingsErrorText, type SettingsMessageSetter } from "./settingsControllerUtils.js";

export function useAutoTimingRuntimeController(options: {
    open: boolean;
    lang: Language;
    profile: Profile;
    setProfile: (profile: Profile) => void;
    setBusy: (busy: boolean) => void;
    setMessage: SettingsMessageSetter;
    at: AutoTimingHook;
    refresh: (notify?: boolean) => Promise<void>;
    autoTimingLoaded: boolean;
    settingsLoadKey: number;
}) {
    const { at, autoTimingLoaded, lang, open, profile, refresh, setBusy, setMessage, setProfile, settingsLoadKey } =
        options;
    const t = lang.settings;
    const [job, setJob] = useState<JobModel | null>(null);
    const [runtimeError, setRuntimeError] = useState("");
    const skipAutoTimingSave = useRef(true);
    const autoTimingSaveTimer = useRef<number | null>(null);

    const runtimeJobRunning = Boolean(job && ["queued", "running"].includes(job.status));
    const runtimeJobElapsed = secondsSince(job?.started_at);
    const runtimeJobLastOutput = secondsSince(job?.last_output_at || job?.started_at);

    const buildSettingsPayload = at.buildSettingsPayload;

    useEffect(() => {
        skipAutoTimingSave.current = true;
    }, [settingsLoadKey]);

    useEffect(() => {
        if (!job || !["queued", "running"].includes(job.status)) return;
        const timer = window.setInterval(async () => {
            try {
                const next = await getJob(job.job_id);
                setJob(next);
                if (["succeeded", "failed", "canceled"].includes(next.status)) {
                    void refresh();
                }
            } catch (error) {
                setMessage(backendMessageText(error, lang.backendMessages), "error");
            }
        }, 1400);
        return () => window.clearInterval(timer);
    }, [job, lang.backendMessages, refresh, setMessage]);

    const saveAutoTimingDefaults = useCallback(async () => {
        try {
            await updateSettings(buildSettingsPayload());
            notifySettingsUpdated();
            toastPubSub.pub({ type: "success", text: t.messages.autoTimingSaved });
        } catch (error) {
            setMessage(settingsErrorText(error, t.messages, lang.backendMessages), "error");
        }
    }, [buildSettingsPayload, lang.backendMessages, setMessage, t.messages]);

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

    const saveProfile = async (value: Profile) => {
        setProfile(value);
        setBusy(true);
        setMessage(t.messages.saving, "info");
        try {
            await updateSettings({ auto_roller_profile: value });
            notifySettingsUpdated();
            await refresh();
            setMessage("");
            toastPubSub.pub({ type: "success", text: t.messages.saved });
        } catch (error) {
            setMessage(settingsErrorText(error, t.messages, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    const runRuntimeJob = async (task: () => Promise<JobModel>) => {
        setBusy(true);
        setRuntimeError("");
        try {
            const created = await task();
            setJob(created);
            toastPubSub.pub({ type: "success", text: t.messages.runtimeJobStarted.replace("{id}", created.job_id) });
        } catch (error) {
            setRuntimeError(backendMessageText(error, lang.backendMessages));
        } finally {
            setBusy(false);
        }
    };

    const runDoctor = () => runRuntimeJob(runAutoRollerDoctor);
    const runInstall = () => runRuntimeJob(() => runAutoRollerInstall({ profile }));
    const runUpgrade = () => runRuntimeJob(() => upgradeAutoRoller({ profile }));
    const runCacheModel = () =>
        runRuntimeJob(() =>
            cacheModel({
                language: at.language,
                transcriber_backend: at.transcriberBackend || null,
                transcriber_model_name: at.transcriberModel || null,
                transcriber_model_path: null,
                transcriber_hf_xet: at.hfXet || null,
                transcriber_hf_proxy: at.hfProxy || null,
                transcriber_hf_etag_timeout: optionalPositiveIntValue(at.hfEtagTimeout),
                transcriber_hf_download_timeout: optionalPositiveIntValue(at.hfDownloadTimeout),
                transcriber_hf_max_workers: optionalPositiveIntValue(at.hfMaxWorkers),
            })
        );

    const cancelRuntimeJob = async () => {
        if (!job || !runtimeJobRunning) return;
        setBusy(true);
        setRuntimeError("");
        try {
            const canceled = await cancelJob(job.job_id);
            setJob(canceled);
        } catch (error) {
            setRuntimeError(backendMessageText(error, lang.backendMessages));
        } finally {
            setBusy(false);
        }
    };

    const copyDiagnostics = async (runtime: AutoRollerRuntime | null) => {
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

    return {
        cancelRuntimeJob,
        copyDiagnostics,
        job,
        runCacheModel,
        runDoctor,
        runInstall,
        runUpgrade,
        runtimeError,
        runtimeJobElapsed,
        runtimeJobLastOutput,
        runtimeJobRunning,
        saveProfile,
    };
}
