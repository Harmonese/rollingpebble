import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ProjectModel } from "../../shared/api.js";
import { loadProjectAudioForPlayback, loadProjectAudioUrlForPlayback } from "../../shared/audioEvents.js";
import { SETTINGS_UPDATED_EVENT } from "../../shared/settingsEvents.js";

const HIDDEN_RECENT_PROJECTS_KEY = "lrc-roller.hiddenRecentProjects";
const DEFAULT_RECENT_PROJECTS_LIMIT = 8;

const formatLyricsSource = (source?: string | null): string => {
    if (!source) return "manual";
    if (source === "lrclib") return "LRCLIB";
    if (source === "local file") return "local file";
    if (source === "automatic timing") return "automatic timing";
    return source;
};

function readHiddenRecentProjects(): Set<string> {
    try {
        const parsed = JSON.parse(localStorage.getItem(HIDDEN_RECENT_PROJECTS_KEY) || "[]");
        return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []);
    } catch {
        return new Set();
    }
}

function writeHiddenRecentProjects(ids: Set<string>): void {
    localStorage.setItem(HIDDEN_RECENT_PROJECTS_KEY, JSON.stringify([...ids]));
}

export const ProjectPanel: React.FC<{
    project: ProjectModel | null;
    onProject: (project: ProjectModel, applyToEditor?: boolean) => void;
}> = ({ project, onProject }) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [projects, setProjects] = useState<ProjectModel[]>([]);
    const [hiddenProjects, setHiddenProjects] = useState<Set<string>>(() => readHiddenRecentProjects());
    const [recentLimit, setRecentLimit] = useState(DEFAULT_RECENT_PROJECTS_LIMIT);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");

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
        refresh().catch((error: Error) => setMessage(error.message));
        void refreshSettings();
    }, []);

    useEffect(() => {
        const onSettingsUpdated = () => void refreshSettings();
        window.addEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
        return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
    }, []);

    const visibleProjects = useMemo(
        () => projects.filter((item) => !hiddenProjects.has(item.project_id)).slice(0, recentLimit),
        [projects, hiddenProjects, recentLimit],
    );

    const hiddenCount = projects.filter((item) => hiddenProjects.has(item.project_id)).length;

    const onAudioUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        loadProjectAudioForPlayback(file);
        setBusy(true);
        setMessage("Creating local project...");
        try {
            const created = await api.createProject(file);
            onProject(created, true);
            const nextHidden = new Set(hiddenProjects);
            nextHidden.delete(created.project_id);
            setHiddenProjects(nextHidden);
            writeHiddenRecentProjects(nextHidden);
            await refresh();
            setMessage(`Project created: ${created.project_id}`);
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
            ev.target.value = "";
        }
    };

    const loadProject = async (projectId: string) => {
        setBusy(true);
        try {
            const loaded = await api.getProject(projectId);
            onProject(loaded, true);
            if (loaded.audio_name) {
                loadProjectAudioUrlForPlayback(api.projectAudioUrl(projectId));
            }
            setMessage(`Loaded ${projectId}.`);
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const hideProject = (projectId: string) => {
        const next = new Set(hiddenProjects);
        next.add(projectId);
        setHiddenProjects(next);
        writeHiddenRecentProjects(next);
        setMessage("Removed from Recent projects. Project files were not deleted.");
    };

    const clearRecent = () => {
        const next = new Set(projects.map((item) => item.project_id));
        setHiddenProjects(next);
        writeHiddenRecentProjects(next);
        setMessage("Recent projects cleared. Project files were not deleted.");
    };

    const restoreRecent = () => {
        const next = new Set<string>();
        setHiddenProjects(next);
        writeHiddenRecentProjects(next);
        setMessage("Recent projects restored.");
    };

    return (
        <section className="roller-card">
            <h2>Project</h2>
            <button
                className="roller-import-button"
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
            >
                <span className="roller-import-icon">+</span>
                <span>
                    <b>Import Audio</b>
                    <small>Create project with local file.</small>
                </span>
            </button>
            <input
                ref={inputRef}
                className="roller-hidden-file"
                type="file"
                accept="audio/*,.mp3,.flac,.wav,.m4a,.aac,.ogg,.opus,.ncm,.qmcflac,.qmc0,.qmc1,.qmc2,.qmc3"
                onChange={onAudioUpload}
                disabled={busy}
            />
            {project && (
                <div className="roller-kv">
                    <b>ID</b><span>{project.project_id}</span>
                    <b>Audio</b><span>{project.audio_name || "-"}</span>
                    <b>Title</b><span>{project.metadata.track || "-"}</span>
                    <b>Artist</b><span>{project.metadata.artist || "-"}</span>
                    <b>Duration</b><span>{project.metadata.duration ? `${project.metadata.duration}s` : "-"}</span>
                    <b>Lyrics source</b><span>{formatLyricsSource(project.source)}</span>
                </div>
            )}
            <details>
                <summary>Recent projects</summary>
                <div className="recent-projects-head">
                    <span>{visibleProjects.length}/{projects.length} shown</span>
                    <div>
                        <button type="button" disabled={!projects.length} onClick={clearRecent}>Clear</button>
                        {hiddenCount > 0 && <button type="button" onClick={restoreRecent}>Restore</button>}
                    </div>
                </div>
                <div className="roller-list recent-projects-list">
                    {visibleProjects.map((item) => (
                        <div key={item.project_id} className="recent-project-row">
                            <button className="recent-project-open" type="button" onClick={() => loadProject(item.project_id)}>
                                <span>{item.audio_name || item.project_id}</span>
                                <small>{item.metadata.artist || item.metadata.track ? `${item.metadata.artist || "Unknown artist"} · ${item.metadata.track || "Untitled"}` : item.project_id}</small>
                            </button>
                            <button
                                className="recent-project-dismiss"
                                type="button"
                                aria-label={`Remove ${item.audio_name || item.project_id} from recent projects`}
                                title="Remove from Recent projects"
                                onClick={() => hideProject(item.project_id)}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    {!visibleProjects.length && <p className="roller-muted">No recent projects to show.</p>}
                </div>
            </details>
            {message && <p className="roller-message">{message}</p>}
        </section>
    );
};
