import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMessage } from "../../hooks/useMessage.js";
import { useSettingsUpdated } from "../../hooks/useSettingsUpdated.js";
import { deleteProject, listProjects } from "../../shared/api/projects.js";
import { backendMessageText } from "../../shared/api/request.js";
import { settings } from "../../shared/api/settings.js";
import type { ProjectModel } from "../../shared/api/types.js";
import { appContext, AppContextBits } from "../../shared/appContext.js";
import { notifyProjectsChanged, PROJECTS_CHANGED_EVENT } from "../../shared/projectEvents.js";
import { readLocalText, writeLocalText } from "../../storage/browserStorage.js";
import { useConfirmDialog } from "../../ui/ConfirmDialog.js";
import { Button, ButtonGroup, Message, Panel } from "../../ui/index.js";
import { toastPubSub } from "../../ui/Toast.js";
import { ProjectSummary } from "./parts/ProjectSummary.js";
import { ProjectSwitcher } from "./parts/ProjectSwitcher.js";
import { RecentProjectList } from "./parts/RecentProjectList.js";

const DEFAULT_RECENT_PROJECTS_LIMIT = 8;
const DELETE_UNDO_MS = 10_000;
const PROJECT_ORDER_KEY = "rollingpebble.projectOrder";

function readProjectOrder(): string[] {
    try {
        const parsed = JSON.parse(readLocalText(PROJECT_ORDER_KEY, "[]"));
        return Array.isArray(parsed) ? parsed.filter((id: unknown) => typeof id === "string") : [];
    } catch {
        return [];
    }
}

function writeProjectOrder(ids: string[]): void {
    writeLocalText(PROJECT_ORDER_KEY, JSON.stringify(ids));
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
    onOpenProject: (projectId: string) => Promise<void>;
    onSave: () => Promise<ProjectModel>;
    draftAudioName?: string;
    draftMetadata?: ProjectModel["metadata"];
    draftSource?: string;
    dirty: boolean;
    canSave: boolean;
    saving: boolean;
    transitioning: boolean;
}> = (
    {
        project,
        onOpenProject,
        onSave,
        draftAudioName,
        draftMetadata,
        draftSource,
        dirty,
        canSave,
        saving,
        transitioning,
    },
) => {
    const confirm = useConfirmDialog();
    const [projects, setProjects] = useState<ProjectModel[]>([]);
    const [projectOrder, setProjectOrder] = useState<string[]>(() => readProjectOrder());
    const [recentLimit, setRecentLimit] = useState(DEFAULT_RECENT_PROJECTS_LIMIT);
    const [busy, setBusy] = useState(false);
    const { lang } = useContext(appContext, AppContextBits.lang);
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
            const runtimeSettings = await settings();
            const value = Number(runtimeSettings.recent_projects_limit || DEFAULT_RECENT_PROJECTS_LIMIT);
            setRecentLimit(
                Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : DEFAULT_RECENT_PROJECTS_LIMIT,
            );
        } catch {
            setRecentLimit(DEFAULT_RECENT_PROJECTS_LIMIT);
        }
    };

    const refresh = async () => {
        const list = await listProjects();
        setProjects(list);
    };

    useEffect(() => {
        refresh().catch((error: Error) => setMessage(backendMessageText(error, lang.backendMessages), "error"));
    }, []);

    useSettingsUpdated(refreshSettings, true);

    useEffect(() => {
        if (!project?.project_id) return;
        // Refresh when saving or Auto Timing establishes a project identity.
        refresh().catch((error: Error) => setMessage(backendMessageText(error, lang.backendMessages), "error"));
    }, [project?.project_id]);

    useEffect(() => {
        const changed = () => {
            void refresh().catch((error) => setMessage(backendMessageText(error, lang.backendMessages), "error"));
        };
        window.addEventListener(PROJECTS_CHANGED_EVENT, changed);
        return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, changed);
    }, [lang]);

    const saveCurrent = async () => {
        try {
            await onSave();
            setMessage(u.projectSaved, "success");
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        }
    };

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
        if (saving || transitioning || busy) return;
        setBusy(true);
        try {
            await onOpenProject(projectId);
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
            await deleteProject(projectId);
            notifyProjectsChanged([projectId]);
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

    const handleDismiss = async (projectId: string) => {
        if (pendingDeleteTimers.current.has(projectId)) return;
        if (await confirm({ message: u.deleteConfirm.replace("{id}", projectId), danger: true }) !== "confirm") return;
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
        <Panel title={u.project}>
            <ProjectSummary
                project={project}
                draftAudioName={draftAudioName}
                draftMetadata={draftMetadata}
                draftSource={draftSource}
                saved={Boolean(project && !dirty)}
                labels={u}
            />
            <ProjectSwitcher
                currentIndex={currentIndex}
                total={orderedProjects.length}
                labels={u}
                onSwitch={switchProject}
            />
            <RecentProjectList
                projects={visibleProjects}
                total={orderedProjects.length}
                pendingDeleteIds={pendingDeleteIds}
                dragProjectId={dragProjectId}
                dragOverProjectId={dragOverProjectId}
                labels={u}
                onRestoreAll={handleRestoreAll}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragLeave={() => setDragOverProjectId(null)}
                onDragEnd={clearDragState}
                onDrop={onDrop}
                onLoadProject={(projectId) => void loadProject(projectId)}
                onRestore={handleRestore}
                onDismiss={handleDismiss}
            />
            <ButtonGroup>
                <Button
                    tone="primary"
                    className="studio-action-start"
                    disabled={!canSave || saving || transitioning || busy || (!dirty && Boolean(project))}
                    onClick={() => void saveCurrent()}
                >
                    {saving ? u.savingProject : u.saveProject}
                </Button>
            </ButtonGroup>
            <Message message={message} type={messageType} fading={messageFading} messageKey={messageKey} />
        </Panel>
    );
};
