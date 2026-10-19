import { useContext, useEffect, useRef, useState } from "react";
import { cancelJob } from "../../../shared/api/jobs.js";
import {
    cachedModels,
    getModels,
    type ManagedModel,
    manageModels,
    type ModelAction,
    modelJobActive,
    modelName,
} from "../../../shared/api/models.js";
import { backendMessageText } from "../../../shared/api/request.js";
import { settings, updateSettings } from "../../../shared/api/settings.js";
import { appContext } from "../../../shared/appContext.js";
import { formatBytes } from "../../../shared/format.js";
import { useConfirmDialog } from "../../../ui/ConfirmDialog.js";
import { ActionRow, Button, MessageText, StatusPill } from "../../../ui/index.js";
import { ModelDownloadFields, type ModelNetwork, modelNetwork } from "./ModelDownloadFields.js";

export const modelMaintenanceJob = () => cachedModels()?.job?.job_id;

export function EngineModels({ ready }: { ready: boolean }) {
    const { lang } = useContext(appContext);
    const t = lang.modelSetup;
    const confirm = useConfirmDialog();
    const [report, setReport] = useState(cachedModels);
    const [network, setNetwork] = useState<ModelNetwork | null>(null);
    const [error, setError] = useState("");
    const [queryError, setQueryError] = useState("");
    const [busy, setBusy] = useState(false);
    const actionLock = useRef(false);
    const running = modelJobActive(report?.job);
    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const refresh = async () => {
            try {
                const next = await getModels();
                if (stopped) return;
                setReport(next);
                setQueryError("");
            } catch (e) {
                if (!stopped) setQueryError(backendMessageText(e, lang.backendMessages));
            }
            if (!stopped) timer = setTimeout(() => void refresh(), 1000);
        };
        void refresh();
        void settings().then(value => {
            if (!stopped) setNetwork(modelNetwork(value));
        })
            .catch(e => {
                if (!stopped) setError(backendMessageText(e, lang.backendMessages));
            });
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, []);
    const saveNetwork = async () => {
        if (network) await updateSettings(network);
    };
    const manage = async (model: ManagedModel | null, action: ModelAction) => {
        if (actionLock.current || running || !ready) return;
        actionLock.current = true;
        setBusy(true);
        setError("");
        try {
            if (
                action === "remove" && await confirm({ message: lang.timingV2.removeModel, danger: true }) !== "confirm"
            ) return;
            if (action === "download" || action === "repair") await saveNetwork();
            await manageModels(action, model ? [model.kind] : undefined, !model);
            setReport(await getModels());
        } catch (e) {
            setError(backendMessageText(e, lang.backendMessages));
        } finally {
            actionLock.current = false;
            setBusy(false);
        }
    };
    return (
        <>
            {network && (
                <div
                    onBlur={() => void saveNetwork().catch(e => setError(backendMessageText(e, lang.backendMessages)))}
                >
                    <ModelDownloadFields value={network} onChange={setNetwork} disabled={busy} />
                </div>
            )}
            {report?.models.map(model => {
                const active = running && report.job?.progress?.stage !== "checking_external"
                    && report.job?.progress?.detail?.kind === model.kind;
                const progress = active ? report.job?.progress : null;
                const issue = report.startup_issues.find(item => item.origin === "managed" && item.kind === model.kind);
                const action = issue && issue.action !== "configure" ? issue.action : model.status === "missing"
                    ? "download"
                    : model.status === "corrupt" || model.status === "failed"
                    ? "repair"
                    : "verify";
                return (
                    <div key={model.kind}>
                        <ActionRow title={modelName(model.kind)} description={formatBytes(model.total_bytes)}>
                            <StatusPill>
                                {active && report.job?.status === "cancelling"
                                    ? t.cancelling
                                    : active && progress?.stage === "verifying_download"
                                    ? t.verifyingDownload
                                    : model.status === "failed" && model.failure_phase === "downloading"
                                    ? t.downloadFailed
                                    : t[model.status]}
                            </StatusPill>
                            <Button
                                disabled={!ready || busy || running || !network}
                                onClick={() => void manage(model, action)}
                            >
                                {action === "download" ? lang.timingV2.download : t[action]}
                            </Button>
                            {model.status !== "missing" && (
                                <Button
                                    tone="danger"
                                    disabled={!ready || busy || running}
                                    onClick={() => void manage(model, "remove")}
                                >
                                    {lang.timingV2.remove}
                                </Button>
                            )}
                            {active && (
                                <Button
                                    disabled={report.job?.status === "cancelling"}
                                    onClick={() => {
                                        if (report.job) {
                                            void cancelJob(report.job.job_id).catch(e =>
                                                setError(backendMessageText(e, lang.backendMessages))
                                            );
                                        }
                                    }}
                                >
                                    {lang.ui.cancel}
                                </Button>
                            )}
                        </ActionRow>
                        {progress && (progress.bytes_total || 0) > 0 && (
                            <div className="model-byte-progress">
                                <progress
                                    aria-label={modelName(model.kind)}
                                    max={Math.max(1, progress.bytes_total || 0)}
                                    value={progress.bytes_downloaded || 0}
                                />
                                <span>
                                    {formatBytes(progress.bytes_downloaded)} / {formatBytes(progress.bytes_total)}
                                </span>
                            </div>
                        )}
                    </div>
                );
            })}
            {report?.external_models.map(model => (
                <ActionRow key={model.kind} title={`${modelName(model.kind)} · ${t.external}`} description={model.path}>
                    <StatusPill>
                        {running && report.job?.progress?.stage === "checking_external"
                                && report.job.progress.detail?.kind === model.kind
                            ? t.checkingExternal
                            : model.status === "available"
                            ? t.ready
                            : t[model.status]}
                    </StatusPill>
                    <Button
                        disabled={!ready || busy || running}
                        onClick={() =>
                            void manage(null, "verify")}
                    >
                        {t.verify}
                    </Button>
                </ActionRow>
            ))}
            {queryError && <MessageText type="error">{queryError}</MessageText>}
            {report?.job?.status === "failed" && (
                <MessageText type="error">
                    {backendMessageText(report.job.error_message, lang.backendMessages)}
                </MessageText>
            )}
            {error && <MessageText type="error">{error}</MessageText>}
        </>
    );
}
