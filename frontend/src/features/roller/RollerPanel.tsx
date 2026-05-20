import { useContext, useEffect, useMemo, useState } from "react";
import { appContext, ChangBits } from "../../components/app.context.js";
import { PanelMessage } from "../../components/PanelMessage.js";
import { SegmentedTabs } from "../../components/SegmentedTabs.js";
import { toastPubSub } from "../../components/toast.js";
import { useAutoTimingState } from "../../hooks/useAutoTimingState.js";
import { useMessage } from "../../hooks/useMessage.js";
import { useSettingsUpdated } from "../../hooks/useSettingsUpdated.js";
import {
    api,
    backendMessageText,
    type JobModel,
    type MetaModel,
    type ProjectModel,
    type RollPreview,
} from "../../shared/api.js";
import { formatBytes } from "../../shared/format.js";
import { hasLyricContent } from "../../shared/lrc.js";
import { AutoTimingFields } from "./AutoTimingFields.js";
import { includesStage } from "./autoTimingOptions.js";

function formatCommandPreview(commandText: string | null | undefined, placeholder: string): string {
    if (!commandText) return placeholder;
    return commandText.replace(/\s--/g, " \\\n  --");
}

type InputState = {
    ready: boolean;
    audioReady: boolean;
    lyricsReady: boolean;
    reason: string;
};

function computeInputState(
    project: ProjectModel | null,
    plainLyrics: string,
    syncedLyrics: string,
    stages: string,
    msgs: { noProject: string; noAudio: string; noLyrics: string; ready: string },
): InputState {
    const needsAudio = includesStage(stages, "s") || includesStage(stages, "f") || includesStage(stages, "t");
    const needsLyrics = includesStage(stages, "p");
    const audioReady = !needsAudio || Boolean(project?.audio_path);
    const lyricsReady = !needsLyrics || hasLyricContent(plainLyrics) || hasLyricContent(syncedLyrics);
    if (!project) {
        return { ready: false, audioReady, lyricsReady, reason: msgs.noProject };
    }
    if (!audioReady) {
        return { ready: false, audioReady, lyricsReady, reason: msgs.noAudio };
    }
    if (!lyricsReady) {
        return { ready: false, audioReady, lyricsReady, reason: msgs.noLyrics };
    }
    return { ready: true, audioReady, lyricsReady, reason: msgs.ready };
}

function normalizeProgressStage(stage: string): string {
    const normalized = (stage || "").replace(/-/g, "_");
    if (normalized === "transcriber_preflight") return "preflight";
    if (normalized === "model_download") return "model_download";
    return normalized;
}

function progressStageLabel(
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

function progressMessage(
    progress: JobModel["progress"],
    msg: {
        waiting: string;
        working: string;
        segmentsUnit: string;
        backendMessages: Record<string, string | undefined>;
    },
): string {
    if (!progress) return msg.waiting;
    if (progress.message_message) return backendMessageText(progress.message_message, msg.backendMessages);
    if (progress.bytes_downloaded != null || progress.bytes_total != null) {
        const pieces = [`${formatBytes(progress.bytes_downloaded)} / ${formatBytes(progress.bytes_total)}`];
        if (progress.bytes_per_second != null) pieces.push(`${formatBytes(progress.bytes_per_second)}/s`);
        if (progress.repo_id) pieces.push(progress.repo_id);
        return pieces.join(" · ");
    }
    if (normalizeProgressStage(progress.stage || "") === "transcriber" && progress.message) {
        const detail = progress.detail || {};
        const audioTime = typeof detail.audio_time_processed === "number" ? detail.audio_time_processed : null;
        const duration = typeof detail.audio_duration === "number" ? detail.audio_duration : null;
        const segments = typeof detail.segments === "number" ? detail.segments : null;
        const parts = [progress.message];
        if (audioTime != null && duration) parts.push(`${audioTime.toFixed(1)}s / ${duration.toFixed(1)}s`);
        if (segments != null) parts.push(msg.segmentsUnit.replace("{n}", String(segments)));
        return parts.join(" · ");
    }
    return progress.message || msg.working;
}

function runtimeMessage(text: string, u: { autoTimingRuntimeNotReady: string }): string {
    if (
        text
            === "Auto Timing runtime is not ready. Create or repair the isolated runtime in Settings before running py-roller."
    ) {
        return u.autoTimingRuntimeNotReady || text;
    }
    return text;
}

function jobStatusLabel(
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

function buildStageSequence(labels: Record<string, string>) {
    return [
        { key: "preflight", label: labels.preflight },
        { key: "model_download", label: labels.modelDownload },
        { key: "splitter", label: labels.splitter },
        { key: "filter", label: labels.filter },
        { key: "transcriber", label: labels.transcriber },
        { key: "parser", label: labels.parser },
        { key: "aligner", label: labels.aligner },
        { key: "writer", label: labels.writer },
    ];
}

function stageStatus(
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

export const RollerPanel: React.FC<{
    project: ProjectModel | null;
    plainLyrics: string;
    syncedLyrics: string;
    editorMeta: MetaModel;
    onProject: (project: ProjectModel, applyToEditor?: boolean) => void;
    onImportText: (text: string) => void;
}> = ({ project, plainLyrics, syncedLyrics, editorMeta, onProject, onImportText }) => {
    const at = useAutoTimingState();
    const [batchMode, setBatchMode] = useState<"single" | "batch">("single");
    const [batchProjects, setBatchProjects] = useState<ProjectModel[]>([]);
    const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
    const [job, setJob] = useState<JobModel | null>(null);
    const [preview, setPreview] = useState<RollPreview | null>(null);
    const [previewBusy, setPreviewBusy] = useState(false);
    const [previewError, setPreviewError] = useState("");
    const [message, setMessage, , messageFading, messageType, messageKey] = useMessage();
    const [busy, setBusy] = useState(false);
    const { lang, prefState } = useContext(appContext, ChangBits.lang | ChangBits.prefState);
    const u = lang.ui;
    const s = lang.settings;
    const tm = lang.toast.autoTiming;
    const trOpt = (key: string) => (lang.optionLabels as Record<string, string | undefined>)?.[key] || key;

    // Merge UI language into the roll payload so py-roller can set PYROLLER_LANG
    const rollPayload = () => ({ ...at.buildRollPayload(), ui_lang: prefState.lang });

    const inputState = useMemo(
        () =>
            computeInputState(project, plainLyrics, syncedLyrics, at.stages, {
                noProject: u.selectProject,
                noAudio: u.noAudio,
                noLyrics: u.noLyrics,
                ready: u.ready,
            }),
        [project, plainLyrics, syncedLyrics, at.stages, u.selectProject, u.noAudio, u.noLyrics, u.ready],
    );

    const loadDefaults = async () => {
        try {
            const settings = await api.settings();
            at.loadFromSettings(settings);
        } catch {
            // Settings are optional for initial rendering. Keep built-in defaults.
        }
    };

    useSettingsUpdated(loadDefaults, true);

    useEffect(() => {
        if (!project) {
            setPreview(null);
            setPreviewError("");
            setPreviewBusy(false);
            return;
        }
        let canceled = false;
        setPreviewBusy(true);
        setPreviewError("");
        const timer = window.setTimeout(async () => {
            try {
                const next = await api.rollPreview(project.project_id, rollPayload());
                if (!canceled) setPreview(next);
            } catch (error) {
                if (!canceled) {
                    setPreview(null);
                    setPreviewError(backendMessageText(error, lang.backendMessages));
                }
            } finally {
                if (!canceled) setPreviewBusy(false);
            }
        }, 350);
        return () => {
            canceled = true;
            window.clearTimeout(timer);
        };
    }, [project?.project_id, at.buildRollPayload]);

    useEffect(() => {
        if (!job || !["queued", "running"].includes(job.status)) return;
        const timer = window.setInterval(async () => {
            try {
                const updated = await api.getJob(job.job_id);
                setJob(updated);
                if (updated.status === "succeeded" && updated.result?.synced_lyrics) {
                    onImportText(String(updated.result.synced_lyrics));
                    if (project) {
                        const refreshed = await api.getProject(project.project_id);
                        onProject(refreshed, false);
                    }
                    toastPubSub.pub({ type: "success", text: tm.finished });
                }
                if (updated.status === "failed") toastPubSub.pub({ type: "error", text: updated.error || tm.failed });
                if (updated.status === "canceled") toastPubSub.pub({ type: "warning", text: tm.canceled });
            } catch (error) {
                setMessage(backendMessageText(error, lang.backendMessages), "error");
            }
        }, 1500);
        return () => window.clearInterval(timer);
    }, [job, onImportText, onProject, project]);

    const saveAndPreview = async () => {
        if (!project) throw new Error(tm.selectProject);
        await api.saveEditor(project.project_id, {
            plain_lyrics: plainLyrics,
            synced_lyrics: syncedLyrics,
            metadata: editorMeta,
        });
        const next = await api.rollPreview(project.project_id, rollPayload());
        setPreview(next);
        setPreviewError("");
        return next;
    };

    const start = async () => {
        if (!project) {
            setMessage(tm.selectProject, "warning");
            return;
        }
        if (!inputState.ready) {
            setMessage(inputState.reason, "warning");
            return;
        }
        setBusy(true);
        setMessage(tm.starting, "info");
        try {
            await saveAndPreview();
            const created = await api.roll(project.project_id, rollPayload());
            setJob(created);
            setMessage("");
            toastPubSub.pub({ type: "success", text: tm.started.replace("{id}", created.job_id) });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    const retry = async () => {
        setMessage(tm.retrying, "info");
        await start();
    };

    const cancel = async () => {
        if (!job) return;
        setBusy(true);
        try {
            const canceled = await api.cancelJob(job.job_id);
            setJob(canceled);
            toastPubSub.pub({ type: "success", text: tm.cancelRequested });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    // -- batch ------------------------------------------------------------

    const loadBatchProjects = async () => {
        try {
            const list = await api.listProjects();
            setBatchProjects(list);
        } catch (error) {
            setBatchProjects([]);
            setMessage(
                tm.batchLoadFailed.replace("{message}", backendMessageText(error, lang.backendMessages)),
                "warning",
            );
        }
    };

    const toggleBatchProject = (id: string) => {
        setSelectedBatchIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAllBatchProjects = () => {
        setSelectedBatchIds(new Set(batchProjects.map((p) => p.project_id)));
    };

    const deselectAllBatchProjects = () => {
        setSelectedBatchIds(new Set());
    };

    const startBatch = async () => {
        if (selectedBatchIds.size === 0) {
            setMessage(tm.selectOneProject, "warning");
            return;
        }
        setBusy(true);
        setMessage(tm.batchStarting, "info");
        try {
            const payload = { ...rollPayload(), project_ids: [...selectedBatchIds], continue_on_error: true };
            const created = await api.batchRoll(payload);
            setJob(created);
            setMessage("");
            toastPubSub.pub({
                type: "success",
                text: tm.batchStarted.replace("{id}", created.job_id).replace("{count}", String(selectedBatchIds.size)),
            });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    // -- rendering --------------------------------------------------------

    const copyCommand = async () => {
        const text = preview?.command_text || job?.command.join(" ") || "";
        if (!text) return;
        try {
            await navigator.clipboard?.writeText(text);
            toastPubSub.pub({ type: "success", text: tm.commandCopied });
        } catch (error) {
            toastPubSub.pub({ type: "error", text: backendMessageText(error, lang.backendMessages) || u.copyFailed });
        }
    };

    const copyLog = async () => {
        if (!job) return;
        try {
            await navigator.clipboard?.writeText(job.logs.join("\n") || job.command.join(" "));
            toastPubSub.pub({ type: "success", text: tm.logCopied });
        } catch (error) {
            toastPubSub.pub({ type: "error", text: backendMessageText(error, lang.backendMessages) || u.copyFailed });
        }
    };

    const openJobFolder = async () => {
        if (!job) return;
        try {
            const result = await api.openJobFolder(job.job_id);
            toastPubSub.pub({ type: "success", text: tm.openedFolder.replace("{path}", result.path) });
        } catch (error) {
            toastPubSub.pub({ type: "error", text: backendMessageText(error, lang.backendMessages) });
        }
    };

    const stageLabels = {
        queued: u.statusQueued,
        running: u.statusRunning,
        preflight: u.modelPreflight,
        modelDownload: u.modelDownload,
        splitter: u.splitter,
        filter: u.filtering,
        transcriber: u.transcription,
        parser: u.lyricsParsing,
        aligner: u.alignment,
        writer: u.writer,
    };
    const stageSequence = useMemo(() => buildStageSequence(stageLabels), [stageLabels]);
    const commandPreviewText = formatCommandPreview(preview?.command_text, u.commandPreviewPlaceholder);

    const running = !!job && ["queued", "running"].includes(job.status);
    const startDisabled = busy || running || !inputState.ready;
    const logsOpen = !!job && ["running", "failed", "succeeded", "canceled"].includes(job.status);
    const progress = job?.progress || null;
    const progressPercent = progress?.progress ?? progress?.percent ?? null;
    const progressWidth = typeof progressPercent === "number" && Number.isFinite(progressPercent)
        ? `${Math.max(0, Math.min(1, progressPercent)) * 100}%`
        : undefined;
    const showProgress = !!job && ["queued", "running", "succeeded", "failed", "canceled"].includes(job.status);

    return (
        <section className="roller-card">
            <h2>{u.autoTiming}</h2>

            <SegmentedTabs
                ariaLabel={u.autoTiming}
                items={[{ value: "single", label: u.single }, { value: "batch", label: u.batch }]}
                value={batchMode}
                onChange={(next) => {
                    setBatchMode(next);
                    if (next === "batch") void loadBatchProjects();
                }}
            />

            {batchMode === "batch" && (
                <>
                    <div className="roller-section-title">{u.selectProjects}</div>
                    {batchProjects.length === 0 && <p className="roller-muted">{u.noBatchProjects}</p>}
                    {batchProjects.length > 0 && (
                        <>
                            <div className="roller-actions compact">
                                <button type="button" onClick={selectAllBatchProjects}>{u.selectAll}</button>
                                <button type="button" onClick={deselectAllBatchProjects}>{u.deselectAll}</button>
                            </div>
                            <div className="roller-list batch-project-list">
                                {batchProjects.map((p) => (
                                    <label key={p.project_id} className="batch-project-option">
                                        <input
                                            type="checkbox"
                                            checked={selectedBatchIds.has(p.project_id)}
                                            onChange={() => toggleBatchProject(p.project_id)}
                                        />
                                        <span>
                                            <b>{p.audio_name || p.project_id}</b>
                                            {p.audio_name && <small>{p.project_id}</small>}
                                        </span>
                                    </label>
                                ))}
                            </div>
                            <p className="roller-muted">{u.selected.replace("{n}", String(selectedBatchIds.size))}</p>
                        </>
                    )}
                </>
            )}

            {batchMode === "single" && (
                <>
                    <div className="roller-section-title">{u.inputStatus}</div>
                    <div className="roller-input-status">
                        <span className={inputState.audioReady ? "status-ok" : "status-missing"}>
                            {u.audio}: {at.includesTranscriber || at.includesSplitter || at.includesFilter
                                ? (inputState.audioReady ? u.ready : u.missing)
                                : u.notNeeded}
                        </span>
                        <span className={inputState.lyricsReady ? "status-ok" : "status-missing"}>
                            {u.lyrics}:{" "}
                            {at.includesParser ? (inputState.lyricsReady ? u.ready : u.missing) : u.notNeeded}
                        </span>
                    </div>
                    {!inputState.ready && <p className="roller-warning">{inputState.reason}</p>}
                    {previewError && <p className="roller-warning">{runtimeMessage(previewError, u)}</p>}
                </>
            )}

            <div className="roller-section-title">{u.parameters}</div>
            <AutoTimingFields at={at} labels={s.autoTiming} optionLabel={trOpt} showOnlyIncluded disableUnavailable />

            {showProgress && (
                <section className="roller-progress-card" aria-live="polite">
                    <div className="roller-progress-head">
                        <b>
                            {progressStageLabel(
                                progress?.stage || (job?.status === "queued" ? "queued" : "running"),
                                stageLabels,
                                { preparing: u.preparing, complete: u.complete },
                            )}
                        </b>
                        <span>
                            {typeof progressPercent === "number"
                                ? `${Math.round(progressPercent * 100)}%`
                                : jobStatusLabel(job?.status, u)}
                        </span>
                    </div>
                    <div className={progressWidth ? "roller-progress-bar" : "roller-progress-bar indeterminate"}>
                        <span style={progressWidth ? { width: progressWidth } : undefined} />
                    </div>
                    <div className="roller-progress-meta">
                        <span>
                            {progressMessage(progress, {
                                waiting: u.progressWaiting,
                                working: u.progressWorking,
                                segmentsUnit: u.segmentsUnit,
                                backendMessages: lang.backendMessages,
                            })}
                        </span>
                        {progress && progress.total > 0 && (
                            <em>{progress.completed}/{progress.total} {progress.unit}</em>
                        )}
                    </div>
                    {progress?.cache_dir && <p className="roller-muted progress-cache">Cache: {progress.cache_dir}</p>}
                    <ol className="roller-stage-list">
                        {stageSequence.map((item) => (
                            <li
                                key={item.key}
                                className={`stage-${
                                    stageStatus(
                                        item.key,
                                        progress?.stage || "",
                                        stageSequence,
                                        job?.status,
                                        job?.completed_stages || [],
                                    )
                                }`}
                            >
                                <span />
                                {item.label}
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            <div className="roller-section-title">{u.run}</div>
            <div className="roller-actions roller-run-actions">
                {batchMode === "single"
                    ? (
                        <>
                            <button
                                type="button"
                                className="roller-action-start"
                                disabled={startDisabled}
                                onClick={() => void start()}
                            >
                                {u.start}
                            </button>
                            <button
                                type="button"
                                className="roller-action-cancel"
                                disabled={!running || busy}
                                onClick={() => void cancel()}
                            >
                                {u.cancel}
                            </button>
                            <button
                                type="button"
                                className="roller-action-retry"
                                disabled={busy || running || !project}
                                onClick={() => void retry()}
                            >
                                {u.retry}
                            </button>
                        </>
                    )
                    : (
                        <>
                            <button
                                type="button"
                                className="roller-action-start"
                                disabled={busy || running || selectedBatchIds.size === 0}
                                onClick={() => void startBatch()}
                            >
                                {u.startBatch}
                            </button>
                            <button
                                type="button"
                                className="roller-action-cancel"
                                disabled={!running || busy}
                                onClick={() => void cancel()}
                            >
                                {u.cancel}
                            </button>
                            <button
                                type="button"
                                className="roller-action-retry"
                                disabled={busy || running || selectedBatchIds.size === 0}
                                onClick={() => void startBatch()}
                            >
                                {u.retry}
                            </button>
                        </>
                    )}
            </div>
            <PanelMessage message={message} type={messageType} fading={messageFading} messageKey={messageKey} />

            {batchMode === "single" && (
                <details>
                    <summary>{u.commandPreview}</summary>
                    <div className="roller-actions compact">
                        <button type="button" disabled={!preview && !job} onClick={() => void copyCommand()}>
                            {u.copyCommand}
                        </button>
                    </div>
                    {previewBusy && <p className="roller-muted">{u.updatingPreview}</p>}
                    {(preview?.warning_messages?.length
                        ? preview.warning_messages.map((warning) => backendMessageText(warning, lang.backendMessages))
                        : preview?.warnings || []).map((warning) => (
                            <p key={warning} className="roller-warning">{warning}</p>
                        ))}
                    <pre
                        className="roller-command"
                        aria-label={u.commandPreview}
                    ><code>{commandPreviewText}</code></pre>
                </details>
            )}

            {batchMode === "single" && job && (
                <details open={logsOpen}>
                    <summary>{u.jobSummary.replace("{status}", jobStatusLabel(job.status, u))} · {job.job_id}</summary>
                    <div className="roller-actions compact">
                        <button type="button" disabled={!job} onClick={() => void copyLog()}>{u.copyLog}</button>
                        <button type="button" disabled={!job.project_id} onClick={() => void openJobFolder()}>
                            {u.openJobFolder}
                        </button>
                    </div>
                    {(job.error_message || job.error) && (
                        <p className="roller-warning">
                            {job.error_message
                                ? backendMessageText(job.error_message, lang.backendMessages)
                                : job.error}
                        </p>
                    )}
                    <pre className="roller-log">{job.logs.join("\n") || job.command.join(" ")}</pre>
                </details>
            )}
        </section>
    );
};
