import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { appContext, ChangBits } from "../../components/app.context.js";
import { PanelMessage } from "../../components/PanelMessage.js";
import { toastPubSub } from "../../components/toast.js";
import { useMessage } from "../../hooks/useMessage.js";
import { useSettingsUpdated } from "../../hooks/useSettingsUpdated.js";
import { api, backendMessageText, type ProjectModel } from "../../shared/api.js";
import { loadProjectAudioUrlForPlayback } from "../../shared/audioEvents.js";

const DEFAULT_RECENT_PROJECTS_LIMIT = 8;
const DELETE_UNDO_MS = 10_000;
const PROJECT_ORDER_KEY = "rollingpebble.projectOrder";

function formatLyricsSource(
    source: string | null | undefined,
    labels: { manual: string; sourceLrclib: string; sourceLocalFile: string; sourceAutoTiming: string },
): string {
    if (!source || source === "manual") return labels.manual;
    if (source === "lrclib") return labels.sourceLrclib;
    if (source === "local file") return labels.sourceLocalFile;
    if (source === "automatic timing") return labels.sourceAutoTiming;
    return source || "";
}

function readProjectOrder(): string[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(PROJECT_ORDER_KEY) || "[]");
        return Array.isArray(parsed) ? parsed.filter((id: unknown) => typeof id === "string") : [];
    } catch {
        return [];
    }
}

function writeProjectOrder(ids: string[]): void {
    localStorage.setItem(PROJECT_ORDER_KEY, JSON.stringify(ids));
}

function applyOrder(projects: ProjectModel[], order: string[]): ProjectModel[] {
    if (!order.length) return projects;
    const indexMap = new Map(order.map((id, i) => [id, i]));
    const ordered = [...projects];
    ordered.sort((a, b) => {
        const ai = indexMap.get(a.project_id);
        const bi = indexMap.get(b.project_id);
        if (ai !== undefined && bi !== undefined) return ai - bi;
        if (ai !== undefined) return -1;
        if (bi !== undefined) return 1;
        return 0;
    });
    return ordered;
}

export const ProjectPanel: React.FC<{
    project: ProjectModel | null;
    onProject: (project: ProjectModel, applyToEditor?: boolean) => void;
}> = ({ project, onProject }) => {
    const [projects, setProjects] = useState<ProjectModel[]>([]);
    const [projectOrder, setProjectOrder] = useState<string[]>(() => readProjectOrder());
    const [recentLimit, setRecentLimit] = useState(DEFAULT_RECENT_PROJECTS_LIMIT);
    const [_busy, setBusy] = useState(false);
    const { lang } = useContext(appContext, ChangBits.lang);
    const t = lang.toast;
    const u = lang.ui;
    const [message, setMessage, clearMessage, messageFading, messageType, messageKey] = useMessage();
    const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(() => new Set());
    const pendingDeleteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

    // Drag state
    const dragProjectIdRef = useRef<string | null>(null);
    const [dragProjectId, setDragProjectId] = useState<string | null>(null);
    const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);

    const orderedProjects = useMemo(
        () => applyOrder(projects, projectOrder),
        [projects, projectOrder],
    );

    const visibleProjects = useMemo(
        () => orderedProjects.slice(0, recentLimit),
        [orderedProjects, recentLimit],
    );

    const currentIndex = useMemo(() => {
        if (!project) return -1;
        return orderedProjects.findIndex((p) => p.project_id === project.project_id);
    }, [project, orderedProjects]);

    const refreshSettings = async () => {
        try {
            const settings = await api.settings();
            const value = Number(settings.recent_projects_limit || DEFAULT_RECENT_PROJECTS_LIMIT);
            setRecentLimit(
                Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : DEFAULT_RECENT_PROJECTS_LIMIT,
            );
        } catch {
            setRecentLimit(DEFAULT_RECENT_PROJECTS_LIMIT);
        }
    };

    const refresh = async () => {
        const list = await api.listProjects();
        setProjects(list);
    };

    useEffect(() => {
        refresh().catch((error: Error) => setMessage(backendMessageText(error, lang.backendMessages), "error"));
    }, []);

    useSettingsUpdated(refreshSettings, true);

    useEffect(() => {
        if (!project?.project_id) return;
        // Refresh when a new project is created externally (ImportAudio)
        refresh().catch((error: Error) => setMessage(backendMessageText(error, lang.backendMessages), "error"));
    }, [project?.project_id]);

    // Clean up pending delete timer on unmount
    useEffect(() => {
        return () => {
            for (const timer of pendingDeleteTimers.current.values()) clearTimeout(timer);
            pendingDeleteTimers.current.clear();
        };
    }, []);

    const switchProject = (direction: -1 | 1) => {
        if (currentIndex < 0 || !orderedProjects.length) return;
        const next = (currentIndex + direction + orderedProjects.length) % orderedProjects.length;
        loadProject(orderedProjects[next].project_id);
    };

    const loadProject = async (projectId: string) => {
        setBusy(true);
        try {
            const loaded = await api.getProject(projectId);
            onProject(loaded, true);
            if (loaded.audio_name) {
                loadProjectAudioUrlForPlayback(api.projectAudioUrl(projectId));
            }
            toastPubSub.pub({ type: "success", text: t.project.loaded.replace("{id}", projectId) });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    const removePendingDelete = (projectId: string) => {
        pendingDeleteTimers.current.delete(projectId);
        setPendingDeleteIds((prev) => {
            const next = new Set(prev);
            next.delete(projectId);
            return next;
        });
    };

    const finalizeDelete = async (projectId: string) => {
        removePendingDelete(projectId);
        try {
            await api.deleteProject(projectId);
            toastPubSub.pub({ type: "warning", text: t.project.deleted.replace("{id}", projectId) });
            setProjectOrder((prev) => {
                const next = prev.filter((id) => id !== projectId);
                writeProjectOrder(next);
                return next;
            });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        }
        await refresh();
    };

    const handleDismiss = (projectId: string) => {
        if (pendingDeleteTimers.current.has(projectId)) return;
        if (!window.confirm(u.deleteConfirm.replace("{id}", projectId))) return;
        const timer = setTimeout(() => {
            void finalizeDelete(projectId);
        }, DELETE_UNDO_MS);
        pendingDeleteTimers.current.set(projectId, timer);
        setPendingDeleteIds((prev) => {
            const next = new Set(prev);
            next.add(projectId);
            return next;
        });
        setMessage(t.project.willDelete.replace("{id}", projectId), "warning", DELETE_UNDO_MS);
    };

    const handleRestore = (projectId: string) => {
        const timer = pendingDeleteTimers.current.get(projectId);
        if (!timer) return;
        clearTimeout(timer);
        removePendingDelete(projectId);
        clearMessage();
        toastPubSub.pub({ type: "success", text: t.project.deletionCanceled });
    };

    const handleRestoreAll = () => {
        for (const timer of pendingDeleteTimers.current.values()) clearTimeout(timer);
        pendingDeleteTimers.current.clear();
        setPendingDeleteIds(new Set());
        clearMessage();
        toastPubSub.pub({ type: "success", text: t.project.deletionCanceled });
    };

    // Drag-and-drop handlers
    const onDragStart = (ev: React.DragEvent, projectId: string) => {
        if (pendingDeleteIds.has(projectId)) {
            ev.preventDefault();
            return;
        }
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("application/x-rollingpebble-project", projectId);
        dragProjectIdRef.current = projectId;
        setDragProjectId(projectId);
    };

    const onDragOver = (ev: React.DragEvent, projectId: string) => {
        if (!dragProjectIdRef.current || pendingDeleteIds.has(projectId)) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        setDragOverProjectId(projectId);
    };

    const clearDragState = () => {
        dragProjectIdRef.current = null;
        setDragProjectId(null);
        setDragOverProjectId(null);
    };

    const onDrop = (targetProjectId: string) => {
        const sourceProjectId = dragProjectIdRef.current;
        if (!sourceProjectId || sourceProjectId === targetProjectId || pendingDeleteIds.has(targetProjectId)) {
            clearDragState();
            return;
        }
        const reordered = [...orderedProjects];
        const from = reordered.findIndex((item) => item.project_id === sourceProjectId);
        const to = reordered.findIndex((item) => item.project_id === targetProjectId);
        if (from < 0 || to < 0) {
            clearDragState();
            return;
        }
        const [moved] = reordered.splice(from, 1);
        reordered.splice(to, 0, moved);
        const newOrder = reordered.map((p) => p.project_id);
        setProjectOrder(newOrder);
        writeProjectOrder(newOrder);
        clearDragState();
    };

    return (
        <section className="roller-card">
            <h2>{u.project}</h2>
            {project && (
                <div className="roller-kv">
                    <b>{u.id}</b>
                    <span>{project.project_id}</span>
                    <b>{u.audio}</b>
                    <span>{project.audio_name || "-"}</span>
                    <b>{u.title}</b>
                    <span>{project.metadata.track || "-"}</span>
                    <b>{u.artist}</b>
                    <span>{project.metadata.artist || "-"}</span>
                    <b>{u.duration}</b>
                    <span>{project.metadata.duration ? `${project.metadata.duration}s` : "-"}</span>
                    <b>{u.lyricsSource}</b>
                    <span>{formatLyricsSource(project.source, u)}</span>
                </div>
            )}

            <div className="project-switcher">
                <button
                    type="button"
                    className="project-switcher-btn"
                    aria-label={u.previousProject}
                    disabled={currentIndex <= 0}
                    onClick={() => switchProject(-1)}
                >
                    ←
                </button>
                <span className="project-switcher-label">
                    {currentIndex >= 0 ? `${currentIndex + 1} / ${orderedProjects.length}` : "- / -"}
                </span>
                <button
                    type="button"
                    className="project-switcher-btn"
                    aria-label={u.nextProject}
                    disabled={currentIndex < 0 || currentIndex >= orderedProjects.length - 1}
                    onClick={() => switchProject(1)}
                >
                    →
                </button>
            </div>

            <details>
                <summary>{u.projectList}</summary>
                <div className="recent-projects-head">
                    <span>
                        {u.shown.replace("{n}", String(visibleProjects.length)).replace(
                            "{total}",
                            String(orderedProjects.length),
                        )}
                    </span>
                    <div>
                        {pendingDeleteIds.size > 0 && (
                            <button type="button" className="project-restore-btn" onClick={handleRestoreAll}>
                                {u.restore} ({pendingDeleteIds.size})
                            </button>
                        )}
                    </div>
                </div>
                <div className="roller-list recent-projects-list">
                    {visibleProjects.map((item) => {
                        const pendingDelete = pendingDeleteIds.has(item.project_id);
                        return (
                            <div
                                key={item.project_id}
                                className={[
                                    "recent-project-row",
                                    pendingDelete ? "pending-delete" : "",
                                    dragProjectId === item.project_id ? "dragging" : "",
                                    dragOverProjectId === item.project_id && dragProjectId !== item.project_id
                                        ? "drag-target"
                                        : "",
                                ].filter(Boolean).join(" ")}
                                draggable={!pendingDelete}
                                onDragStart={(ev) => onDragStart(ev, item.project_id)}
                                onDragOver={(ev) => onDragOver(ev, item.project_id)}
                                onDragLeave={() => setDragOverProjectId(null)}
                                onDragEnd={clearDragState}
                                onDrop={() => onDrop(item.project_id)}
                            >
                                <span className="recent-project-grip" title={u.dragToReorder}>⋮⋮</span>
                                <button
                                    className="recent-project-open"
                                    type="button"
                                    disabled={pendingDelete}
                                    onClick={() => loadProject(item.project_id)}
                                >
                                    <span>{item.audio_name || item.project_id}</span>
                                    <small>
                                        {item.metadata.artist || item.metadata.track
                                            ? `${item.metadata.artist || u.unknownArtist} · ${
                                                item.metadata.track || u.untitled
                                            }`
                                            : item.project_id}
                                    </small>
                                </button>
                                {pendingDelete
                                    ? (
                                        <button
                                            className="recent-project-restore-inline"
                                            type="button"
                                            onClick={() => handleRestore(item.project_id)}
                                            title={u.restore}
                                        >
                                            {u.restore}
                                        </button>
                                    )
                                    : (
                                        <button
                                            className="recent-project-dismiss"
                                            type="button"
                                            aria-label={`${u.deleteProject}: ${item.audio_name || item.project_id}`}
                                            title={u.deleteProject}
                                            onClick={() => handleDismiss(item.project_id)}
                                        >
                                            ×
                                        </button>
                                    )}
                            </div>
                        );
                    })}
                    {!visibleProjects.length && <p className="roller-message subtle">{u.noProjects}</p>}
                </div>
            </details>
            <PanelMessage message={message} type={messageType} fading={messageFading} messageKey={messageKey} />
        </section>
    );
};
