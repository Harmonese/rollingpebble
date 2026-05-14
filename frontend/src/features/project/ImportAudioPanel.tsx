import { useMemo, useRef, useState } from "react";
import { api, type NeteaseSong, type ProjectModel } from "../../shared/api.js";
import { prepareAudioFile } from "../../shared/audioDecode.js";
import { loadProjectAudioForPlayback, loadProjectAudioUrlForPlayback } from "../../shared/audioEvents.js";

type AudioSourceKind = "local" | "netease";

const formatDuration = (seconds: number): string => {
    if (!seconds) return "-";
    const minute = Math.floor(seconds / 60);
    const second = Math.round(seconds % 60).toString().padStart(2, "0");
    return `${minute}:${second}`;
};

export const ImportAudioPanel: React.FC<{
    project: ProjectModel | null;
    onProject: (project: ProjectModel, applyToEditor?: boolean) => void;
}> = ({ project, onProject }) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [source, setSource] = useState<AudioSourceKind>("local");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [neteaseLink, setNeteaseLink] = useState("");
    const [neteaseQuery, setNeteaseQuery] = useState("");
    const [neteaseResults, setNeteaseResults] = useState<NeteaseSong[]>([]);

    const defaultNeteaseQuery = useMemo(() => {
        const meta = project?.metadata;
        return [meta?.track, meta?.artist].filter(Boolean).join(" ");
    }, [project?.metadata.artist, project?.metadata.track]);

    const onAudioUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        setBusy(true);
        setMessage("Preparing local audio...");
        try {
            const prepared = await prepareAudioFile(file);
            loadProjectAudioForPlayback(prepared.file);
            setMessage(prepared.decoded ? "Decoded audio in memory. Creating local project..." : "Creating local project...");
            const created = await api.createProject(prepared.file);
            onProject(created, true);
            setMessage(`Project created: ${created.project_id}`);
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
            ev.target.value = "";
        }
    };

    const matchNeteaseLink = async () => {
        const value = neteaseLink.trim();
        if (!value) {
            setMessage("Enter a NetEase song link or song ID.");
            return;
        }
        setBusy(true);
        setMessage("Matching NetEase song...");
        try {
            const response = await api.neteaseResolve(value);
            setNeteaseResults([response.song]);
            setMessage("1 result.");
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const searchNetease = async () => {
        const query = (neteaseQuery || defaultNeteaseQuery).trim();
        if (!query) {
            setMessage("Enter a NetEase search query.");
            return;
        }
        setBusy(true);
        setMessage("Searching NetEase...");
        try {
            const meta = project?.metadata;
            const response = await api.neteaseSearch({
                query,
                track: meta?.track,
                artist: meta?.artist,
                album: meta?.album,
                limit: 20,
            });
            setNeteaseResults(response.results);
            setMessage(`${response.results.length} result(s).`);
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const loadNeteaseAudio = (song: NeteaseSong) => {
        // Prefer the same-origin backend proxy. It resolves NetEase's current playable
        // URL server-side and avoids localhost hotlink/referrer quirks. Fall back to
        // Akari/lrc-maker's direct outer URL if the proxy cannot stream the track.
        loadProjectAudioUrlForPlayback(song.playback_url || song.outer_audio_url, song.outer_audio_url || undefined);
        setMessage(`Loaded NetEase audio link: ${song.label || song.id}`);
    };

    const openSong = (url: string) => {
        window.open(url, "_blank", "noopener,noreferrer");
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
                    <b>Import Audio</b>
                    <small>Create project with local file.</small>
                </span>
            </button>
        </div>
    );

    const renderNetease = () => (
        <div className="local-file-import">
            <div className="roller-section-title">Song Link</div>
            <div className="roller-form">
                <input
                    placeholder="https://music.163.com/#/song?id=..."
                    value={neteaseLink}
                    onChange={(ev) => setNeteaseLink(ev.target.value)}
                    onKeyDown={(ev) => {
                        if (ev.key === "Enter") void matchNeteaseLink();
                    }}
                />
            </div>
            <div className="roller-actions">
                <button
                    type="button"
                    disabled={busy || !neteaseLink.trim()}
                    onClick={matchNeteaseLink}
                >
                    Match Link
                </button>
            </div>

            <div className="roller-section-title">Search</div>
            <div className="roller-form">
                <input
                    placeholder={defaultNeteaseQuery || "Song title and artist"}
                    value={neteaseQuery}
                    onChange={(ev) => setNeteaseQuery(ev.target.value)}
                    onKeyDown={(ev) => {
                        if (ev.key === "Enter") void searchNetease();
                    }}
                />
            </div>
            <div className="roller-actions">
                <button
                    type="button"
                    disabled={busy || !(neteaseQuery.trim() || defaultNeteaseQuery)}
                    onClick={searchNetease}
                >
                    Search
                </button>
            </div>
            <div className="roller-results">
                {neteaseResults.map((song) => (
                    <article key={song.id} className="roller-result">
                        <b>{song.label || song.id}</b>
                        <small>ID: {song.id} · duration: {formatDuration(song.duration)}</small>
                        <div className="roller-actions compact">
                            <button type="button" onClick={() => loadNeteaseAudio(song)}>Load Audio Link</button>
                            <button type="button" onClick={() => openSong(song.song_url)}>Open Song</button>
                        </div>
                    </article>
                ))}
            </div>
        </div>
    );

    return (
        <section className="roller-card audio-import-card">
            <h2>Import Audio</h2>
            <div className="library-strip" role="tablist" aria-label="Audio sources">
                <button
                    className={`library-chip ${source === "local" ? "active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={source === "local"}
                    onClick={() => setSource("local")}
                >
                    Local Files
                </button>
                <button
                    className={`library-chip ${source === "netease" ? "active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={source === "netease"}
                    onClick={() => setSource("netease")}
                >
                    NetEase
                </button>
            </div>
            {source === "local" ? renderLocal() : renderNetease()}
            {message && <p className="roller-message">{message}</p>}
        </section>
    );
};
