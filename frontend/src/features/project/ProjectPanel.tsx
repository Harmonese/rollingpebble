import { useEffect, useRef, useState } from "react";
import { api, type ProjectModel } from "../../shared/api.js";
import { loadProjectAudioForPlayback, loadProjectAudioUrlForPlayback } from "../../shared/audioEvents.js";

const formatLyricsSource = (source?: string | null): string => {
    if (!source) return "manual";
    if (source === "lrclib") return "LRCLIB";
    if (source === "local file") return "local file";
    if (source === "automatic timing") return "automatic timing";
    return source;
};

export const ProjectPanel: React.FC<{
    project: ProjectModel | null;
    onProject: (project: ProjectModel, applyToEditor?: boolean) => void;
}> = ({ project, onProject }) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [projects, setProjects] = useState<ProjectModel[]>([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");

    const refresh = async () => {
        const list = await api.listProjects();
        setProjects(list);
    };

    useEffect(() => {
        refresh().catch((error: Error) => setMessage(error.message));
    }, []);

    const onAudioUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        loadProjectAudioForPlayback(file);
        setBusy(true);
        setMessage("Creating local project...");
        try {
            const created = await api.createProject(file);
            onProject(created, true);
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
                <div className="roller-list">
                    {projects.map((item) => (
                        <button key={item.project_id} type="button" onClick={() => loadProject(item.project_id)}>
                            {item.audio_name || item.project_id}
                        </button>
                    ))}
                    {!projects.length && <p className="roller-muted">No local projects yet.</p>}
                </div>
            </details>
            {message && <p className="roller-message">{message}</p>}
        </section>
    );
};
