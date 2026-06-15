import type { ProjectModel } from "../../../shared/api/types.js";
import { MessageText } from "../../../ui/index.js";

export const RecentProjectList: React.FC<{
    projects: ProjectModel[];
    total: number;
    pendingDeleteIds: Set<string>;
    dragProjectId: string | null;
    dragOverProjectId: string | null;
    labels: {
        projectList: string;
        shown: string;
        restore: string;
        dragToReorder: string;
        unknownArtist: string;
        untitled: string;
        deleteProject: string;
        noProjects: string;
    };
    onRestoreAll: () => void;
    onDragStart: (ev: React.DragEvent, projectId: string) => void;
    onDragOver: (ev: React.DragEvent, projectId: string) => void;
    onDragLeave: () => void;
    onDragEnd: () => void;
    onDrop: (projectId: string) => void;
    onLoadProject: (projectId: string) => void;
    onRestore: (projectId: string) => void;
    onDismiss: (projectId: string) => void;
}> = ({
    projects,
    total,
    pendingDeleteIds,
    dragProjectId,
    dragOverProjectId,
    labels,
    onRestoreAll,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDragEnd,
    onDrop,
    onLoadProject,
    onRestore,
    onDismiss,
}) => (
    <details>
        <summary>{labels.projectList}</summary>
        <div className="recent-projects-head">
            <span>
                {labels.shown.replace("{n}", String(projects.length)).replace("{total}", String(total))}
            </span>
            <div>
                {pendingDeleteIds.size > 0 && (
                    <button type="button" className="project-restore-btn" onClick={onRestoreAll}>
                        {labels.restore} ({pendingDeleteIds.size})
                    </button>
                )}
            </div>
        </div>
        <div className="studio-list recent-projects-list">
            {projects.map((item) => {
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
                        onDragLeave={onDragLeave}
                        onDragEnd={onDragEnd}
                        onDrop={() => onDrop(item.project_id)}
                    >
                        <span className="recent-project-grip" title={labels.dragToReorder}>⋮⋮</span>
                        <button
                            className="recent-project-open"
                            type="button"
                            disabled={pendingDelete}
                            onClick={() => onLoadProject(item.project_id)}
                        >
                            <span>{item.audio_name || item.project_id}</span>
                            <small>
                                {item.metadata.artist || item.metadata.track
                                    ? `${item.metadata.artist || labels.unknownArtist} · ${
                                        item.metadata.track || labels.untitled
                                    }`
                                    : item.project_id}
                            </small>
                        </button>
                        {pendingDelete
                            ? (
                                <button
                                    className="recent-project-restore-inline"
                                    type="button"
                                    onClick={() => onRestore(item.project_id)}
                                    title={labels.restore}
                                >
                                    {labels.restore}
                                </button>
                            )
                            : (
                                <button
                                    className="recent-project-dismiss"
                                    type="button"
                                    aria-label={`${labels.deleteProject}: ${item.audio_name || item.project_id}`}
                                    title={labels.deleteProject}
                                    onClick={() => onDismiss(item.project_id)}
                                >
                                    ×
                                </button>
                            )}
                    </div>
                );
            })}
            {!projects.length && <MessageText>{labels.noProjects}</MessageText>}
        </div>
    </details>
);
