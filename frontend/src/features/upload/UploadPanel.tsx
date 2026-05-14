import { useEffect, useMemo, useState } from "react";
import { api, type MetaModel, type NeteaseSong, type ProjectModel, type UploadPlan } from "../../shared/api.js";
import { SETTINGS_UPDATED_EVENT } from "../../shared/settingsEvents.js";

type UploadDestination = "lrclib" | "netease";

const formatDuration = (seconds: number): string => {
    if (!seconds) return "-";
    const minute = Math.floor(seconds / 60);
    const second = Math.round(seconds % 60).toString().padStart(2, "0");
    return `${minute}:${second}`;
};

export const UploadPanel: React.FC<{
    project: ProjectModel | null;
    plainLyrics: string;
    syncedLyrics: string;
    editorMeta: MetaModel;
    onProject: (project: ProjectModel, applyToEditor?: boolean) => void;
}> = ({ project, plainLyrics, syncedLyrics, editorMeta, onProject }) => {
    const [destination, setDestination] = useState<UploadDestination>("lrclib");
    const [mode, setMode] = useState("auto");
    const [allowDerivedPlain, setAllowDerivedPlain] = useState(true);
    const [plan, setPlan] = useState<UploadPlan | null>(null);
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const [neteaseLink, setNeteaseLink] = useState("");
    const [neteaseQuery, setNeteaseQuery] = useState("");
    const [neteaseResults, setNeteaseResults] = useState<NeteaseSong[]>([]);

    const defaultNeteaseQuery = useMemo(() => {
        const meta = editorMeta || project?.metadata;
        return [meta?.track, meta?.artist].filter(Boolean).join(" ");
    }, [editorMeta.artist, editorMeta.track, project?.metadata.artist, project?.metadata.track]);

    useEffect(() => {
        const refreshSettings = async () => {
            try {
                const settings = await api.settings();
                setAllowDerivedPlain(settings.upload_derive_plain_from_synced);
            } catch {
                setAllowDerivedPlain(true);
            }
        };
        void refreshSettings();
        const onSettingsUpdated = () => void refreshSettings();
        window.addEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
        return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
    }, []);

    const payload = () => ({
        mode,
        allow_derived_plain: allowDerivedPlain,
        metadata: editorMeta,
        plain_lyrics: plainLyrics,
        synced_lyrics: syncedLyrics,
    });

    const makePlan = async () => {
        if (!project) {
            setMessage("Create/import an audio project first.");
            return;
        }
        setBusy(true);
        try {
            const updated = await api.saveEditor(project.project_id, {
                plain_lyrics: plainLyrics,
                synced_lyrics: syncedLyrics,
                metadata: editorMeta,
            });
            onProject(updated, false);
            const response = await api.uploadPlan(project.project_id, payload());
            setPlan(response);
            setMessage(response.can_upload ? "Plan is ready." : "Plan has blocking warnings.");
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const runUpload = async () => {
        if (!project) return;
        setBusy(true);
        try {
            const response = await api.uploadRun(project.project_id, payload());
            setMessage(response.message);
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
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
            const meta = editorMeta || project?.metadata;
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

    const openWiki = (song: NeteaseSong) => {
        window.open(song.wiki_url, "_blank", "noopener,noreferrer");
    };

    const renderLrclibUpload = () => (
        <>
            <div className="roller-form">
                <label>Mode
                    <select value={mode} onChange={(ev) => setMode(ev.target.value)}>
                        <option value="auto">auto</option>
                        <option value="mixed">mixed</option>
                        <option value="synced">synced</option>
                        <option value="plain">plain</option>
                        <option value="instrumental">instrumental</option>
                    </select>
                </label>
            </div>
            <div className="roller-actions">
                <button type="button" disabled={busy || !project} onClick={makePlan}>Generate Plan</button>
                <button type="button" disabled={busy || !project || !plan?.can_upload} onClick={runUpload}>Confirm Upload</button>
            </div>
            {plan && (
                <div className="roller-plan">
                    <div className="roller-kv">
                        <b>Can Upload</b><span>{plan.can_upload ? "yes" : "no"}</span>
                        <b>Mode</b><span>{plan.mode}</span>
                        <b>Reason</b><span>{plan.reason}</span>
                        <b>Plain Lines</b><span>{plan.plain_lines}</span>
                        <b>Synced Lines</b><span>{plan.synced_lines}</span>
                    </div>
                    {plan.warnings.length > 0 && <p className="roller-warning">Warnings: {plan.warnings.join(", ")}</p>}
                    <pre className="roller-log">{JSON.stringify(plan.payload_preview, null, 2)}</pre>
                </div>
            )}
        </>
    );

    const renderNeteaseUpload = () => (
        <>
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
                            <button type="button" onClick={() => openWiki(song)}>Open Wiki</button>
                        </div>
                    </article>
                ))}
            </div>
        </>
    );

    return (
        <section className="roller-card">
            <h2>Upload Lyrics</h2>
            <div className="library-strip" role="tablist" aria-label="Upload destinations">
                <button
                    className={`library-chip ${destination === "lrclib" ? "active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={destination === "lrclib"}
                    onClick={() => setDestination("lrclib")}
                >
                    LRCLIB
                </button>
                <button
                    className={`library-chip ${destination === "netease" ? "active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={destination === "netease"}
                    onClick={() => setDestination("netease")}
                >
                    NetEase
                </button>
            </div>
            {destination === "lrclib" ? renderLrclibUpload() : renderNeteaseUpload()}
            {message && <p className="roller-message">{message}</p>}
        </section>
    );
};
