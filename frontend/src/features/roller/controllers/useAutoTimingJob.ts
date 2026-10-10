import { useEffect, useMemo, useRef, useState } from "react";
import { computeAutoTimingInputState } from "../../../domain/auto-timing/inputReadiness.js";
import type { AutoTimingHook } from "../../../domain/auto-timing/useAutoTimingState.js";
import { useMessage } from "../../../hooks/useMessage.js";
import type { Language } from "../../../languages/index.js";
import { autoRollerRuntime, batchRoll, roll, rollPreview } from "../../../shared/api/autoTiming.js";
import { cancelJob, getJob, openJobFolder as openJobFolderApi } from "../../../shared/api/jobs.js";
import { getProject, listProjects } from "../../../shared/api/projects.js";
import { backendMessageText } from "../../../shared/api/request.js";
import { type JobModel, type MetaModel, type ProjectModel, type RollPreview } from "../../../shared/api/types.js";
import { toastPubSub } from "../../../ui/Toast.js";

export type AutoTimingMode = "single" | "batch";

export function useAutoTimingJob(args: {
    at: AutoTimingHook;
    project: ProjectModel | null;
    plainLyrics: string;
    syncedLyrics: string;
    editorMeta: MetaModel;
    uiLang: string;
    lang: Language;
    draftAudioReady: boolean;
    saveWorkspace: () => Promise<ProjectModel>;
    workspaceId: string;
    workspaceSignature: string;
    onJobResult: (workspaceId: string, signature: string, project: ProjectModel) => boolean;
}) {
    const {
        at,
        project,
        plainLyrics,
        syncedLyrics,
        uiLang,
        lang,
        draftAudioReady,
        saveWorkspace,
        workspaceId,
        workspaceSignature,
        onJobResult,
    } = args;
    const u = lang.ui;
    const contextRef = useRef({ workspaceId, workspaceSignature, onJobResult });
    contextRef.current = { workspaceId, workspaceSignature, onJobResult };
    const jobContext = useRef<{ workspaceId: string; signature: string; projectId: string } | null>(null);
    const starting = useRef(false);
    const tm = lang.toast.autoTiming;
    const [batchMode, setBatchMode] = useState<AutoTimingMode>("single");
    const [batchProjects, setBatchProjects] = useState<ProjectModel[]>([]);
    const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
    const [job, setJob] = useState<JobModel | null>(null);
    const [preview, setPreview] = useState<RollPreview | null>(null);
    const [previewBusy, setPreviewBusy] = useState(false);
    const [previewError, setPreviewError] = useState("");
    const [message, setMessage, , messageFading, messageType, messageKey] = useMessage();
    const [busy, setBusy] = useState(false);

    const rollPayload = () => ({ ...at.buildRollPayload(), ui_lang: uiLang });

    const inputState = useMemo(
        () =>
            computeAutoTimingInputState(
                project || (draftAudioReady || plainLyrics.trim() || syncedLyrics.trim()
                    ? { audio_path: draftAudioReady ? "draft" : null }
                    : null),
                plainLyrics,
                syncedLyrics,
                at.stages,
                {
                    noProject: u.selectProject,
                    noAudio: u.noAudio,
                    noLyrics: u.noLyrics,
                    ready: u.ready,
                },
            ),
        [
            project,
            draftAudioReady,
            plainLyrics,
            syncedLyrics,
            at.stages,
            u.selectProject,
            u.noAudio,
            u.noLyrics,
            u.ready,
        ],
    );

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
                const next = await rollPreview(project.project_id, rollPayload());
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
        let canceled = false;
        let polling = false;
        const timer = window.setInterval(async () => {
            if (polling) return;
            polling = true;
            try {
                const updated = await getJob(job.job_id);
                if (canceled) return;
                if (updated.status === "succeeded") {
                    const origin = jobContext.current;
                    if (origin && updated.result?.synced_lyrics) {
                        const refreshed = await getProject(origin.projectId);
                        if (!canceled) {
                            const applied = contextRef.current.onJobResult(
                                origin.workspaceId,
                                origin.signature,
                                refreshed,
                            );
                            toastPubSub.pub({ type: "success", text: applied ? tm.finished : u.jobSavedElsewhere });
                        }
                    } else toastPubSub.pub({ type: "success", text: tm.finished });
                }
                if (canceled) return;
                setJob(updated);
                if (updated.status === "failed") toastPubSub.pub({ type: "error", text: updated.error || tm.failed });
                if (updated.status === "canceled") toastPubSub.pub({ type: "warning", text: tm.canceled });
            } catch (error) {
                if (!canceled) setMessage(backendMessageText(error, lang.backendMessages), "error");
            } finally {
                polling = false;
            }
        }, 1500);
        return () => {
            canceled = true;
            window.clearInterval(timer);
        };
    }, [job?.job_id, job?.status]);

    const start = async () => {
        if (starting.current) return;
        if (!inputState.ready) {
            setMessage(inputState.reason, "warning");
            return;
        }
        starting.current = true;
        setBusy(true);
        setMessage(tm.starting, "info");
        const origin = { workspaceId, signature: workspaceSignature };
        const payload = rollPayload();
        try {
            const runtime = await autoRollerRuntime();
            if (!runtime.available) {
                throw new Error(
                    backendMessageText(
                        runtime.detail_message || runtime.detail || u.runtimeRequired,
                        lang.backendMessages,
                    ),
                );
            }
            if (
                contextRef.current.workspaceId !== origin.workspaceId
                || contextRef.current.workspaceSignature !== origin.signature
            ) {
                setMessage(u.workspaceChanged, "warning");
                return;
            }
            const saved = await saveWorkspace();
            const next = await rollPreview(saved.project_id, payload);
            if (
                contextRef.current.workspaceId !== origin.workspaceId
                || contextRef.current.workspaceSignature !== origin.signature
            ) {
                setMessage(u.workspaceChanged, "warning");
                return;
            }
            if (contextRef.current.workspaceId === origin.workspaceId) setPreview(next);
            jobContext.current = { ...origin, projectId: saved.project_id };
            const created = await roll(saved.project_id, payload);
            setJob(created);
            setMessage("");
            toastPubSub.pub({ type: "success", text: tm.started.replace("{id}", created.job_id) });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            starting.current = false;
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
            const canceled = await cancelJob(job.job_id);
            setJob(canceled);
            toastPubSub.pub({ type: "success", text: tm.cancelRequested });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    const loadBatchProjects = async () => {
        try {
            const list = await listProjects();
            setBatchProjects(list);
        } catch (error) {
            setBatchProjects([]);
            setMessage(
                tm.batchLoadFailed.replace("{message}", backendMessageText(error, lang.backendMessages)),
                "warning",
            );
        }
    };

    const setMode = (next: AutoTimingMode) => {
        setBatchMode(next);
        if (next === "batch") void loadBatchProjects();
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
            jobContext.current = null;
            const created = await batchRoll(payload);
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
            const result = await openJobFolderApi(job.job_id);
            toastPubSub.pub({ type: "success", text: tm.openedFolder.replace("{path}", result.path) });
        } catch (error) {
            toastPubSub.pub({ type: "error", text: backendMessageText(error, lang.backendMessages) });
        }
    };

    const running = !!job && ["queued", "running"].includes(job.status);

    return {
        batchMode,
        setMode,
        batchProjects,
        selectedBatchIds,
        toggleBatchProject,
        selectAllBatchProjects,
        deselectAllBatchProjects,
        job,
        preview,
        previewBusy,
        previewError,
        message,
        messageFading,
        messageType,
        messageKey,
        busy,
        inputState,
        running,
        start,
        retry,
        cancel,
        startBatch,
        copyCommand,
        copyLog,
        openJobFolder,
    };
}
