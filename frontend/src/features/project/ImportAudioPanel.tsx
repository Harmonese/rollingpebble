import { useContext, useRef, useState } from "react";
import { useMessage, type MessageType } from "../../hooks/useMessage.js";
import { toastPubSub } from "../../components/toast.js";
import { appContext, ChangBits } from "../../components/app.context.js";
import { api, type NeteaseSong, type ProjectModel } from "../../shared/api.js";
import { prepareAudioFile } from "../../shared/audioDecode.js";
import { loadProjectAudioForPlayback, loadProjectAudioUrlForPlayback } from "../../shared/audioEvents.js";
import { NeteaseSearch } from "../shared/NeteaseSearch.js";
import type { NeteaseSearchRenderProps } from "../shared/NeteaseSearch.js";

type AudioSourceKind = "local" | "netease";

export const ImportAudioPanel: React.FC<{
    project: ProjectModel | null;
    onProject: (project: ProjectModel, applyToEditor?: boolean) => void;
}> = ({ project, onProject }) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [source, setSource] = useState<AudioSourceKind>("local");
    const [busy, setBusy] = useState(false);
    const [message, setMessage, , messageFading, messageType] = useMessage();
    const { lang } = useContext(appContext, ChangBits.lang);
    const u = lang.ui;
    const t = lang.toast;
    const showMessage = (text: string, type: MessageType, _duration?: number) => {
        toastPubSub.pub({ type, text });
    };

    const onAudioUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        setBusy(true);
        setMessage(t.import.preparing, "info", 10000);
        try {
            const prepared = await prepareAudioFile(file);
            loadProjectAudioForPlayback(prepared.file);
            setMessage(prepared.decoded ? t.import.decoded : t.import.creating, "info", 10000);
            const created = await api.createProject(prepared.file);
            onProject(created, true);
            toastPubSub.pub({ type: "success", text: t.project.created.replace("{id}", created.project_id) });
        } catch (error) {
            setMessage((error as Error).message, "error");
        } finally {
            setBusy(false);
            ev.target.value = "";
        }
    };

    const loadNeteaseAudio = (song: NeteaseSong) => {
        loadProjectAudioUrlForPlayback(song.playback_url || song.outer_audio_url, song.outer_audio_url || undefined);
    };

    const renderLocal = () => (
        <div className="local-file-import">
            <input
                ref={inputRef}
                className="roller-hidden-file"
                type="file"
                accept="audio/*,.mp3,.flac,.wav,.m4a,.aac,.ogg,.opus,.ncm,.qmcflac,.qmcogg,.qmc0,.qmc1,.qmc2,.qmc3"
                onChange={onAudioUpload}
                disabled={busy}
            />
            <button
                className="roller-import-button compact-import"
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
            >
                <span className="roller-import-icon">+</span>
                <span>
                    <b>{u.importAudio}</b>
                    <small>{u.importAudioDesc}</small>
                </span>
            </button>
        </div>
    );

    const renderNeteaseActions = ({ song }: NeteaseSearchRenderProps) => (
        <>
            <button type="button" onClick={() => loadNeteaseAudio(song)}>{u.loadAudioLink}</button>
            <button type="button" onClick={() => window.open(song.song_url, "_blank", "noopener,noreferrer")}>{u.openSong}</button>
        </>
    );

    const renderNetease = () => (
        <div className="local-file-import">
            <NeteaseSearch
                defaultQuery=""
                meta={{ track: project?.metadata.track, artist: project?.metadata.artist, album: project?.metadata.album }}
                onMessage={showMessage}
                renderResultActions={renderNeteaseActions}
            />
        </div>
    );

    return (
        <section className="roller-card audio-import-card">
            <h2>{u.importAudio}</h2>
            <div className="library-strip" role="tablist" aria-label="Audio sources">
                <button
                    className={`library-chip ${source === "local" ? "active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={source === "local"}
                    onClick={() => setSource("local")}
                >
                    {u.localFiles}
                </button>
                <button
                    className={`library-chip ${source === "netease" ? "active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={source === "netease"}
                    onClick={() => setSource("netease")}
                >
                    {u.netease}
                </button>
            </div>
            {source === "local" ? renderLocal() : renderNetease()}
            {message && <p className={`roller-message ${messageType}${messageFading ? " fading" : ""}`}>{message}</p>}
        </section>
    );
};
