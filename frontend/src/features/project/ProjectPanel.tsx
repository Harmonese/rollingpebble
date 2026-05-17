import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMessage } from "../../hooks/useMessage.js";
import { toastPubSub } from "../../components/toast.js";
import { appContext, ChangBits } from "../../components/app.context.js";
import { api, type ProjectModel } from "../../shared/api.js";
import { loadProjectAudioUrlForPlayback } from "../../shared/audioEvents.js";
import { SETTINGS_UPDATED_EVENT } from "../../shared/settingsEvents.js";

const DEFAULT_RECENT_PROJECTS_LIMIT = 8;
const DELETE_UNDO_MS = 10_000;
const PROJECT_ORDER_KEY = "lrc-roller.projectOrder";

function formatLyricsSource(source?: string | null): string {
    if (!source) return "manual";
    if (source === "lrclib") return "LRCLIB";
    if (source === "local file") return "local file";
    if (source === "automatic timing") return "Auto Timing";
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
    const [message, setMessage, , messageFading, messageType] = useMessage();
    const [pendingDelete, setPendingDelete] = useState<{ projectId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
    const pendingDeleteRef = useRef(pendingDelete);
    pendingDeleteRef.current = pendingDelete;
    const projectOrderRef = useRef(projectOrder);
    projectOrderRef.current = projectOrder;

    // Drag state
    const dragIndex = useRef<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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
            setRecentLimit(Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : DEFAULT_RECENT_PROJECTS_LIMIT);
        } catch {
            setRecentLimit(DEFAULT_RECENT_PROJECTS_LIMIT);
        }
    };

    const refresh = async () => {
        const list = await api.listProjects();
        setProjects(list);
    };

    useEffect(() => {
        refresh().catch((error: Error) => setMessage(error.message, "error"));
        void refreshSettings();
    }, []);

    useEffect(() => {
        const onSettingsUpdated = () => void refreshSettings();
        window.addEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
        return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
    }, []);

    useEffect(() => {
        if (!project?.project_id) return;
        // Refresh when a new project is created externally (ImportAudio)
        refresh().catch((error: Error) => setMessage(error.message, "error"));
    }, [project?.project_id]);

    // Clean up pending delete timer on unmount
    useEffect(() => {
        return () => {
            if (pendingDeleteRef.current) {
                clearTimeout(pendingDeleteRef.current.timer);
            }
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
            setMessage((error as Error).message, "error");
        } finally {
            setBusy(false);
        }
    };

    const handleDismiss = (projectId: string) => {
        if (!window.confirm(u.deleteConfirm.replace("{id}", projectId))) return;
        const timer = setTimeout(async () => {
            try {
                await api.deleteProject(projectId);
                toastPubSub.pub({ type: "warning", text: t.project.deleted.replace("{id}", projectId) });
            } catch (error) {
                setMessage((error as Error).message, "error");
            }
            setPendingDelete(null);
            await refresh();
            // Clean up order entry for deleted project
            setProjectOrder((prev) => prev.filter((id) => id !== projectId));
            writeProjectOrder(projectOrderRef.current.filter((id) => id !== projectId));
        }, DELETE_UNDO_MS);
        setPendingDelete({ projectId, timer });
        setMessage(t.project.willDelete.replace("{id}", projectId), "warning", DELETE_UNDO_MS);
    };

    const handleRestore = () => {
        if (!pendingDelete) return;
        clearTimeout(pendingDelete.timer);
        setPendingDelete(null);
        toastPubSub.pub({ type: "success", text: t.project.deletionCanceled });
    };

    // Drag-and-drop handlers
    const onDragStart = (index: number) => {
        dragIndex.current = index;
    };

    const onDragOver = (ev: React.DragEvent, index: number) => {
        ev.preventDefault();
        if (dragIndex.current === null) return;
        setDragOverIndex(index);
    };

    const onDragLeave = () => {
        setDragOverIndex(null);
    };

    const onDrop = (index: number) => {
        const from = dragIndex.current;
        if (from === null || from === index) {
            dragIndex.current = null;
            setDragOverIndex(null);
            return;
        }
        const reordered = [...orderedProjects];
        const [moved] = reordered.splice(from, 1);
        reordered.splice(index, 0, moved);
        const newOrder = reordered.map((p) => p.project_id);
        setProjectOrder(newOrder);
        writeProjectOrder(newOrder);
        dragIndex.current = null;
        setDragOverIndex(null);
    };

    return (
        <section className="roller-card">
            <h2>{u.project}</h2>
            {project && (
                <div className="roller-kv">
                    <b>{u.id}</b><span>{project.project_id}</span>
                    <b>{u.audio}</b><span>{project.audio_name || "-"}</span>
                    <b>{u.title}</b><span>{project.metadata.track || "-"}</span>
                    <b>{u.artist}</b><span>{project.metadata.artist || "-"}</span>
                    <b>{u.duration}</b><span>{project.metadata.duration ? `${project.metadata.duration}s` : "-"}</span>
                    <b>{u.lyricsSource}</b><span>{formatLyricsSource(project.source)}</span>
                </div>
            )}

            <div className="project-switcher">
                <button type="button" className="project-switcher-btn" aria-label="Previous project" disabled={currentIndex <= 0} onClick={() => switchProject(-1)}>←</button>
                <span className="project-switcher-label">{currentIndex >= 0 ? `${currentIndex + 1} / ${orderedProjects.length}` : "- / -"}</span>
                <button type="button" className="project-switcher-btn" aria-label="Next project" disabled={currentIndex < 0 || currentIndex >= orderedProjects.length - 1} onClick={() => switchProject(1)}>→</button>
            </div>

            <details>
                <summary>{u.projectList}</summary>
                <div className="recent-projects-head">
                    <span>{u.shown.replace("{n}", String(visibleProjects.length)).replace("{total}", String(orderedProjects.length))}</span>
                    <div>
                        {pendingDelete && <button type="button" className="project-restore-btn" onClick={handleRestore}>Restore</button>}
                    </div>
                </div>
                <div className="roller-list recent-projects-list">
                    {visibleProjects.map((item, index) => (
                        <div
                            key={item.project_id}
                            className={[
                                "recent-project-row",
                                pendingDelete?.projectId === item.project_id ? "pending-delete" : "",
                                dragIndex.current === index ? "dragging" : "",
                                dragOverIndex === index && dragIndex.current !== index ? "drag-target" : "",
                            ].filter(Boolean).join(" ")}
                            draggable={!pendingDelete}
                            onDragStart={() => onDragStart(index)}
                            onDragOver={(ev) => onDragOver(ev, index)}
                            onDragLeave={onDragLeave}
                            onDrop={() => onDrop(index)}
                        >
                            <span className="recent-project-grip" title={u.dragToReorder}>⋮⋮</span>
                            <button className="recent-project-open" type="button" onClick={() => loadProject(item.project_id)}>
                                <span>{item.audio_name || item.project_id}</span>
                                <small>{item.metadata.artist || item.metadata.track ? `${item.metadata.artist || u.unknownArtist} · ${item.metadata.track || u.untitled}` : item.project_id}</small>
                            </button>
                            {pendingDelete?.projectId === item.project_id ? (
                                <span className="recent-project-deleting" title={u.deleting}>...</span>
                            ) : (
                                <button
                                    className="recent-project-dismiss"
                                    type="button"
                                    aria-label={`Delete ${item.audio_name || item.project_id}`}
                                    title={u.deleteProject}
                                    onClick={() => handleDismiss(item.project_id)}
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    ))}
                    {!visibleProjects.length && <p className="roller-message subtle">No projects to show.</p>}
                </div>
            </details>
            {message && <p className={`roller-message ${messageType}${messageFading ? " fading" : ""}`}>{message}</p>}
        </section>
    );
};
