import { useEffect, useMemo, useState } from "react";
import { toastPubSub } from "../../../ui/Toast.js";
import { computeAutoTimingInputState } from "../../../domain/auto-timing/inputReadiness.js";
import type { AutoTimingHook } from "../../../domain/auto-timing/useAutoTimingState.js";
import { useMessage } from "../../../hooks/useMessage.js";
import type { Language } from "../../../languages/index.js";
import { batchRoll, roll, rollPreview } from "../../../shared/api/autoTiming.js";
import { cancelJob, getJob, openJobFolder as openJobFolderApi } from "../../../shared/api/jobs.js";
import { getProject, listProjects, saveEditor } from "../../../shared/api/projects.js";
import { backendMessageText } from "../../../shared/api/request.js";
import {
    type JobModel,
    type MetaModel,
    type ProjectModel,
    type RollPreview,
} from "../../../shared/api/types.js";

export type AutoTimingMode = "single" | "batch";

export function useAutoTimingJob(args: {
    at: AutoTimingHook;
    project: ProjectModel | null;
    plainLyrics: string;
    syncedLyrics: string;
    editorMeta: MetaModel;
    uiLang: string;
    lang: Language;
    onProject: (project: ProjectModel, applyToEditor?: boolean) => void;
    onImportText: (text: string) => void;
}) {
    const { at, project, plainLyrics, syncedLyrics, editorMeta, uiLang, lang, onProject, onImportText } = args;
    const u = lang.ui;
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
            computeAutoTimingInputState(project, plainLyrics, syncedLyrics, at.stages, {
                noProject: u.selectProject,
                noAudio: u.noAudio,
                noLyrics: u.noLyrics,
                ready: u.ready,
            }),
        [project, plainLyrics, syncedLyrics, at.stages, u.selectProject, u.noAudio, u.noLyrics, u.ready],
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
        const timer = window.setInterval(async () => {
            try {
                const updated = await getJob(job.job_id);
                setJob(updated);
                if (updated.status === "succeeded" && updated.result?.synced_lyrics) {
                    onImportText(String(updated.result.synced_lyrics));
                    if (project) {
                        const refreshed = await getProject(project.project_id);
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
        await saveEditor(project.project_id, {
            plain_lyrics: plainLyrics,
            synced_lyrics: syncedLyrics,
            metadata: editorMeta,
        });
        const next = await rollPreview(project.project_id, rollPayload());
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
            const created = await roll(project.project_id, rollPayload());
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
