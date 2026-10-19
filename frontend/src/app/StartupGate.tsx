import { useContext, useEffect, useRef, useState } from "react";
import {
    ModelDownloadFields,
    type ModelNetwork,
    modelNetwork,
} from "../features/settings/sections/ModelDownloadFields.js";
import { autoRollerRuntime } from "../shared/api/autoTiming.js";
import {
    cancelModels,
    getModels,
    manageModels,
    modelJobActive,
    type ModelKind,
    modelName,
    type ModelsReport,
    waitForModels,
} from "../shared/api/models.js";
import { backendMessageText } from "../shared/api/request.js";
import { waitForRuntime } from "../shared/api/runtimePreparation.js";
import { settings, updateSettings } from "../shared/api/settings.js";
import type { JobModel } from "../shared/api/types.js";
import { appContext } from "../shared/appContext.js";
import { formatBytes } from "../shared/format.js";
import { ActionRow, Button, DialogActionRow, MessageText, Modal, StatusPill } from "../ui/index.js";

type Phase = "environment" | "environment_failed" | "checking" | "ask" | "configure" | "issues" | "working" | "failed";
export function StartupGate({ children, onSettings }: { children: React.ReactNode; onSettings?: () => void }) {
    const { lang } = useContext(appContext);
    const t = lang.modelSetup;
    const [ready, setReady] = useState(false);
    const [phase, setPhase] = useState<Phase>("environment");
    const [environmentPhase, setEnvironmentPhase] = useState("checking");
    const retryScope = useRef<"environment" | "models">("environment");
    const [report, setReport] = useState<ModelsReport | null>(null);
    const [network, setNetwork] = useState<ModelNetwork | null>(null);
    const [job, setJob] = useState<JobModel | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [selected, setSelected] = useState<ModelKind[]>([]);
    const lock = useRef(false);
    const leaving = useRef(false);
    const mounted = useRef(true);
    const polling = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    useEffect(() => {
        let current = true;
        let environment = attempt === 0 || retryScope.current === "environment";
        leaving.current = false;
        setPhase(environment ? "environment" : "checking");
        setJob(null);
        setError("");
        let started: JobModel | null = null;
        void (async () => {
            try {
                if (environment) {
                    setEnvironmentPhase("checking");
                    const runtime = await autoRollerRuntime();
                    if (!current) return;
                    if (!runtime.startup_preparation) {
                        setReady(true);
                        return;
                    }
                    const done = await waitForRuntime(
                        runtime.settings.auto_timing_v2_options?.audio_mode === "vocals",
                        () => current,
                        attempt > 0,
                        state => {
                            if (current) setEnvironmentPhase(state.status);
                        },
                    );
                    if (!current || !done) return;
                    environment = false;
                    setPhase("checking");
                }
                const preferences = await settings();
                if (!current) return;
                setNetwork(modelNetwork(preferences));
                const next = await manageModels("verify", undefined, true);
                started = next;
                if (!current) return;
                setJob(next);
                const result = await waitForModels(next, () => current && !leaving.current, setJob);
                if (!current || leaving.current || !result) return;
                const models = await getModels();
                if (!current || leaving.current) return;
                if (models.startup_issues.length) {
                    showIssues(models);
                } else if (result.status === "failed") {
                    setError(backendMessageText(result.error_message, lang.backendMessages));
                    setPhase("failed");
                } else setReady(true);
            } catch (e) {
                if (current) {
                    setError(backendMessageText(e, lang.backendMessages));
                    setPhase(environment ? "environment_failed" : started ? "checking" : "failed");
                }
            }
        })();
        return () => {
            current = false;
        };
    }, [attempt]);
    const showIssues = (models: ModelsReport) => {
        setReport(models);
        const downloadable = models.startup_issues.filter(issue =>
            issue.origin === "managed"
            && ["download", "repair"].includes(issue.action)
        );
        setSelected(downloadable.map(issue => issue.kind));
        setPhase(
            !models.onboarding_complete
                && models.startup_issues.every(issue => issue.status === "missing" && issue.origin === "managed")
                ? "ask"
                : "issues",
        );
    };
    const finish = async (openSettings = false) => {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        try {
            const latest = await getModels();
            if (modelJobActive(latest.job) && latest.job) await cancelModels(latest.job);
            await updateSettings({ model_onboarding_complete: true });
            if (mounted.current) {
                setReady(true);
                if (openSettings) onSettings?.();
            }
        } catch (e) {
            setError(backendMessageText(e, lang.backendMessages));
        } finally {
            lock.current = false;
            setBusy(false);
        }
    };
    const cancel = async () => {
        if (lock.current || !job) return;
        lock.current = true;
        leaving.current = true;
        setBusy(true);
        setJob({ ...job, status: "cancelling" });
        try {
            await cancelModels(job);
            await updateSettings({ model_onboarding_complete: true });
            if (mounted.current) setReady(true);
        } catch (e) {
            setError(backendMessageText(e, lang.backendMessages));
        } finally {
            lock.current = false;
            setBusy(false);
        }
    };
    const observeDownload = async (next: JobModel) => {
        if (polling.current) return;
        polling.current = true;
        setError("");
        try {
            const result = await waitForModels(next, () => mounted.current && !leaving.current, setJob);
            if (!result || leaving.current || !mounted.current) return;
            const models = await getModels();
            if (!mounted.current || leaving.current) return;
            if (models.startup_issues.length) {
                showIssues(models);
                if (result.status === "failed") {
                    setError(
                        result.error_message
                            ? backendMessageText(result.error_message, lang.backendMessages)
                            : t.downloadFailed,
                    );
                }
            } else if (result.status === "succeeded") setReady(true);
            else {
                setError(
                    result.error_message
                        ? backendMessageText(result.error_message, lang.backendMessages)
                        : t.downloadFailed,
                );
                setPhase("failed");
            }
        } catch (e) {
            setError(backendMessageText(e, lang.backendMessages));
        } finally {
            polling.current = false;
        }
    };
    const download = async () => {
        if (lock.current || !network) return;
        lock.current = true;
        setBusy(true);
        setError("");
        try {
            await updateSettings({ ...network, model_onboarding_complete: true });
            const next = await manageModels("download", selected);
            setJob(next);
            setPhase("working");
            leaving.current = false;
            lock.current = false;
            setBusy(false);
            await observeDownload(next);
        } catch (e) {
            setError(backendMessageText(e, lang.backendMessages));
        } finally {
            if (!leaving.current) {
                lock.current = false;
                setBusy(false);
            }
        }
    };
    if (ready) return <>{children}</>;
    const active = phase === "environment" || phase === "checking" || phase === "working";
    const progress = job?.progress;
    const stage = phase === "environment"
        ? environmentPhase === "preparing" ? t.preparingEnvironment : t.checkingEnvironment
        : progress?.stage === "downloading"
        ? t.downloading
        : progress?.stage === "verifying_download"
        ? t.verifyingDownload
        : progress?.stage === "checking_external"
        ? t.checkingExternal
        : t.checking;
    const count = progress?.completed;
    const total = progress?.total;
    const retry = () => {
        retryScope.current = phase === "environment_failed" ? "environment" : "models";
        setAttempt(value => value + 1);
    };
    const size = report?.models.filter(model => selected.includes(model.kind)).reduce(
        (sum, model) => sum + model.download_bytes,
        0,
    );
    return (
        <main className="page-loading startup-gate" aria-busy={active}>
            <div className="startup-content studio-splash-start">
                <img className="studio-splash-avatar" src="./img/rollingpebble-avatar.webp" alt="" />
                <h1>Rolling Pebble</h1>
                {active && (
                    <>
                        <p role="status">{job?.status === "cancelling" ? t.cancelling : stage}</p>
                        {typeof progress?.detail?.kind === "string" && <p>{modelName(progress.detail.kind)}</p>}
                        {total != null && total > 0 && <p>{formatBytes(count)} / {formatBytes(total)}</p>}
                        {error && <MessageText type="error">{error}</MessageText>}
                        {error && (phase === "working" || phase === "checking") && job && !leaving.current && (
                            <Button
                                disabled={busy}
                                onClick={() => void observeDownload(job)}
                            >
                                {t.retry}
                            </Button>
                        )}
                        {phase !== "environment" && (
                            <Button disabled={!job || busy} onClick={() => void cancel()}>
                                {phase === "checking" ? t.skip : lang.ui.cancel}
                            </Button>
                        )}
                    </>
                )}
                {(phase === "failed" || phase === "environment_failed") && (
                    <>
                        <MessageText type="error">{error || t.operationFailed}</MessageText>
                        <DialogActionRow>
                            <Button
                                disabled={busy}
                                onClick={() => phase === "environment_failed" ? setReady(true) : void finish()}
                            >
                                {lang.timingV2.continueApp}
                            </Button>
                            <Button disabled={busy} onClick={retry}>
                                {phase === "environment_failed" ? lang.timingV2.repair : t.retry}
                            </Button>
                        </DialogActionRow>
                    </>
                )}
            </div>
            <Modal
                open={["ask", "configure", "issues"].includes(phase)}
                onClose={() => {
                    if (!busy && ["ask", "configure", "issues"].includes(phase)) void finish();
                }}
                ariaLabel={t.title}
                modalClassName="confirm-modal"
                exitMs={0}
            >
                <h2>{t.title}</h2>
                {phase === "ask" && <p className="confirm-message">{t.ask}</p>}
                {phase === "issues"
                    && report?.startup_issues.map(issue => (
                        <ActionRow
                            key={`${issue.origin}-${issue.kind}`}
                            title={modelName(issue.kind)}
                            description={issue.origin === "external" ? t.external : undefined}
                        >
                            <StatusPill>
                                {issue.reason === "downloading" ? t.downloadFailed : t[issue.status]}
                            </StatusPill>
                        </ActionRow>
                    ))}
                {phase === "configure" && network && (
                    <ModelDownloadFields value={network} onChange={setNetwork} disabled={busy} />
                )}
                {phase === "configure" && <p>{t.requiredSize}: {formatBytes(size)}</p>}
                {error && <MessageText type="error">{error}</MessageText>}
                <DialogActionRow>
                    <Button disabled={busy} onClick={() => void finish()}>{t.later}</Button>
                    {phase === "issues" && report?.startup_issues.some(issue => issue.action === "configure")
                        && <Button disabled={busy} onClick={() => void finish(true)}>{lang.ui.settings}</Button>}
                    {phase === "issues" && report?.startup_issues.some(issue => issue.action === "verify")
                        && <Button disabled={busy} onClick={retry}>{t.retry}</Button>}
                    {selected.length > 0 && (
                        <Button
                            tone="primary"
                            disabled={busy || !network}
                            onClick={() => {
                                if (phase === "configure") void download();
                                else {
                                    setError("");
                                    setPhase("configure");
                                }
                            }}
                        >
                            {phase === "issues" && report?.startup_issues.every(issue => issue.status === "corrupt")
                                ? t.repair
                                : lang.timingV2.download}
                        </Button>
                    )}
                </DialogActionRow>
            </Modal>
            {active && (
                <progress
                    className="startup-progress"
                    aria-label={stage}
                    max={total ? total : undefined}
                    value={total ? count || 0 : undefined}
                />
            )}
        </main>
    );
}
