import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMessage } from "../../hooks/useMessage.js";
import { toastPubSub } from "../../components/toast.js";
import { appContext, ChangBits } from "../../components/app.context.js";
import { api, type LyricsRecord, type MetaModel, type ProjectModel } from "../../shared/api.js";
import { buildImportText } from "../../shared/lrc.js";
import { SETTINGS_UPDATED_EVENT } from "../../shared/settingsEvents.js";
import { NeteaseSearch } from "../shared/NeteaseSearch.js";
import type { NeteaseSearchRenderProps } from "../shared/NeteaseSearch.js";

const emptyMeta: MetaModel = { track: "", artist: "", album: "", duration: 0 };

type LibraryKind = "lrclib" | "local" | "netease";

const previewText = (record: LyricsRecord) => {
    const plain = (record.plain_lyrics || "").trim();
    const synced = (record.synced_lyrics || "").trim();
    if (!plain && !synced && record.instrumental) return "Instrumental — no lyrics from LRCLIB.";
    if (!plain && !synced) return "No lyric text returned for this record.";
    return [
        synced ? `[Synced lyrics]\n${synced}` : "",
        plain ? `[Plain lyrics]\n${plain}` : "",
    ].filter(Boolean).join("\n\n");
};

const hasLrcTimestamps = (text: string) => /\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/.test(text);

export const LrclibPanel: React.FC<{
    project: ProjectModel | null;
    editorMeta: MetaModel;
    onProject: (project: ProjectModel, applyToEditor?: boolean) => void;
    onImportText: (text: string) => void;
}> = ({ project, editorMeta, onProject, onImportText }) => {
    const [library, setLibrary] = useState<LibraryKind>("lrclib");
    const [meta, setMeta] = useState<MetaModel>(project?.metadata || editorMeta || emptyMeta);
    const [query, setQuery] = useState("");
    const [lrclibId, setLrclibId] = useState("");
    const [results, setResults] = useState<LyricsRecord[]>([]);
    const [message, setMessage, , messageFading, messageType] = useMessage();
    const { lang } = useContext(appContext, ChangBits.lang);
    const t = lang.toast;
    const u = lang.ui;
    const [busy, setBusy] = useState(false);
    const [autoFillFromProject, setAutoFillFromProject] = useState(true);
    const [localFileName, setLocalFileName] = useState("");
    const [localText, setLocalText] = useState("");
    const localInputRef = useRef<HTMLInputElement | null>(null);
    const lastAutoFilledProjectId = useRef<string | null>(null);

    const refreshSettings = async () => {
        try {
            const settings = await api.settings();
            setAutoFillFromProject(settings.auto_fill_lyrics_library_from_project_metadata);
        } catch {
            setAutoFillFromProject(true);
        }
    };

    useEffect(() => {
        void refreshSettings();
        const onSettingsUpdated = () => void refreshSettings();
        window.addEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
        return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
    }, []);

    useEffect(() => {
        if (!autoFillFromProject) return;
        const source = project?.metadata || editorMeta || emptyMeta;
        setMeta({
            track: source.track || "",
            artist: source.artist || "",
            album: source.album || "",
            duration: Number(source.duration) || 0,
        });
        const currentProjectId = project?.project_id || null;
        if (currentProjectId !== lastAutoFilledProjectId.current) {
            lastAutoFilledProjectId.current = currentProjectId;
            const defaultQuery = [source.artist, source.track].filter(Boolean).join(" ");
            setQuery(defaultQuery);
        }
    }, [autoFillFromProject, project?.project_id, project?.metadata.track, project?.metadata.artist, project?.metadata.album, project?.metadata.duration, editorMeta.track, editorMeta.artist, editorMeta.album, editorMeta.duration]);

    const updateMeta = (key: keyof MetaModel, value: string) => {
        setMeta((old) => ({ ...old, [key]: key === "duration" ? Number(value) || 0 : value }));
    };

    const normalizedId = useMemo(() => Number.parseInt(lrclibId.trim(), 10), [lrclibId]);

    const doSearch = async () => {
        setBusy(true);
        setMessage(t.lrclib.searching, "info", 15000);
        try {
            const response = await api.lrclibSearch({ query, track: meta.track, artist: meta.artist, album: meta.album, limit: 20 });
            setResults(response.results);
            toastPubSub.pub({ type: "success", text: t.lrclib.results.replace("{n}", String(response.results.length)) });
        } catch (error) {
            setMessage((error as Error).message, "error");
        } finally {
            setBusy(false);
        }
    };

    const doGet = async () => {
        setBusy(true);
        setMessage(t.lrclib.exactLookup, "info", 10000);
        try {
            const response = await api.lrclibGet(meta);
            setResults(response.record ? [response.record] : []);
            toastPubSub.pub({ type: "success", text: t.lrclib.results.replace("{n}", response.record ? "1" : "0") });
        } catch (error) {
            setMessage((error as Error).message, "error");
        } finally {
            setBusy(false);
        }
    };

    const doGetById = async () => {
        if (!Number.isFinite(normalizedId)) return;
        setBusy(true);
        setMessage(t.lrclib.fetching.replace("{id}", String(normalizedId)), "info", 10000);
        try {
            const record = await api.lrclibGetById(normalizedId);
            setResults(record ? [record] : []);
            toastPubSub.pub({ type: "success", text: t.lrclib.results.replace("{n}", record ? "1" : "0") });
        } catch (error) {
            setMessage((error as Error).message, "error");
        } finally {
            setBusy(false);
        }
    };

    const importRecord = async (record: LyricsRecord, mode: "plain" | "synced") => {
        try {
            const syncedLyrics = mode === "plain" ? "" : record.synced_lyrics.trim();
            const plainLyrics = mode === "synced" ? "" : record.plain_lyrics;
            const payload = {
                metadata: {
                    track: record.track_name || meta.track,
                    artist: record.artist_name || meta.artist,
                    album: record.album_name || meta.album,
                    duration: record.duration || meta.duration || 0,
                },
                plain_lyrics: plainLyrics,
                synced_lyrics: syncedLyrics,
                source: "lrclib",
                lrclib_id: record.id,
            };
            const text = buildImportText({
                ...record,
                plain_lyrics: plainLyrics,
                synced_lyrics: syncedLyrics,
            });
            onImportText(text);
            if (project) {
                const updated = await api.applyLyrics(project.project_id, payload);
                onProject(updated, false);
            }
            toastPubSub.pub({ type: "success", text: t.lrclib.imported });
        } catch (error) {
            setMessage((error as Error).message, "error");
        }
    };

    const onLocalFile = async (ev: React.ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        setLocalFileName(file.name);
        setMessage("");
        try {
            const text = await file.text();
            setLocalText(text);
            toastPubSub.pub({ type: "success", text: t.lrclib.loaded.replace("{name}", file.name) });
        } catch (error) {
            setMessage((error as Error).message, "error");
        } finally {
            ev.target.value = "";
        }
    };

    const importLocalText = async () => {
        const raw = localText.trim();
        if (!raw) return;
        const synced = hasLrcTimestamps(raw);
        try {
            const text = raw;
            onImportText(text);
            if (project) {
                const updated = await api.applyLyrics(project.project_id, {
                    metadata: meta,
                    plain_lyrics: synced ? "" : text,
                    synced_lyrics: synced ? text : "",
                    source: "local file",
                    lrclib_id: null,
                });
                onProject(updated, false);
                toastPubSub.pub({ type: "success", text: t.lrclib.importedLocal.replace("{name}", localFileName || "local lyrics") });
            } else {
                toastPubSub.pub({ type: "success", text: t.lrclib.importedEditor.replace("{name}", localFileName || "local lyrics") });
            }
        } catch (error) {
            setMessage((error as Error).message, "error");
        }
    };

    const searchOnEnter = (ev: React.KeyboardEvent) => {
        if (ev.key === "Enter" && !busy && (query || meta.track)) {
            doSearch();
        }
    };

    const renderLrclib = () => (
        <>
            <div className="roller-form">
                <input placeholder={u.titleTrack} value={meta.track} onChange={(ev) => updateMeta("track", ev.target.value)} onKeyDown={searchOnEnter} />
                <input placeholder={u.artist} value={meta.artist} onChange={(ev) => updateMeta("artist", ev.target.value)} onKeyDown={searchOnEnter} />
                <input placeholder={u.album} value={meta.album} onChange={(ev) => updateMeta("album", ev.target.value)} onKeyDown={searchOnEnter} />
                <input placeholder={u.duration} value={meta.duration || ""} onChange={(ev) => updateMeta("duration", ev.target.value)} onKeyDown={searchOnEnter} />
                <input placeholder={u.searchPlaceholder} value={query} onChange={(ev) => setQuery(ev.target.value)} onKeyDown={searchOnEnter} />
                <input placeholder={u.lrclibId} value={lrclibId} onChange={(ev) => setLrclibId(ev.target.value)} inputMode="numeric" onKeyDown={(ev) => { if (ev.key === "Enter" && !busy && Number.isFinite(normalizedId)) doGetById(); }} />
            </div>
            <div className="roller-actions">
                <button type="button" disabled={busy || (!query && !meta.track)} onClick={doSearch}>{u.search}</button>
                <button type="button" disabled={busy || !meta.track || !meta.artist} onClick={doGet}>{u.exactLookup}</button>
                <button type="button" disabled={busy || !Number.isFinite(normalizedId)} onClick={doGetById}>{u.fetchById}</button>
            </div>
            <div className="roller-results">
                {results.length === 0 && !busy && <p className="roller-muted">No results found.</p>}
                {results.map((record, index) => (
                    <article key={`${record.id || index}-${record.label}`} className="roller-result">
                        <b>{record.label || `${record.artist_name} - ${record.track_name}`}</b>
                        <small>ID: {record.id || "unknown"} · plain: {record.has_plain ? "yes" : "no"} · synced: {record.has_synced ? "yes" : "no"} · instrumental: {record.instrumental ? "yes" : "no"}</small>
                        <details className="result-preview">
                            <summary>{u.preview}</summary>
                            <pre className="lyric-preview">{previewText(record)}</pre>
                        </details>
                        <div className="roller-actions compact">
                            <button type="button" disabled={!record.has_plain} onClick={() => importRecord(record, "plain")}>{u.importPlain}</button>
                            <button type="button" disabled={!record.has_synced} onClick={() => importRecord(record, "synced")}>{u.importSynced}</button>
                        </div>
                    </article>
                ))}
            </div>
        </>
    );

    const renderLocalFiles = () => (
        <div className="local-file-import">
            <input
                ref={localInputRef}
                className="roller-hidden-file"
                type="file"
                accept=".lrc,.txt,text/plain,text/*"
                onChange={onLocalFile}
            />
            <button className="roller-import-button compact-import" type="button" onClick={() => localInputRef.current?.click()}>
                <span className="roller-import-icon">+</span>
                <span>
                    <b>{u.importLyrics}</b>
                    <small>{u.importLyricsDesc}</small>
                </span>
            </button>
            {localFileName && <p className="roller-muted">Selected: {localFileName}</p>}
            <textarea
                className="local-lyrics-preview"
                placeholder={u.localLyricsInput}
                value={localText}
                onChange={(ev) => setLocalText(ev.target.value)}
            />
            <div className="roller-actions">
                <button type="button" disabled={!localText.trim()} onClick={importLocalText}>{u.import}</button>
            </div>
        </div>
    );

    const renderNeteaseActions = ({ song, busy: _b }: NeteaseSearchRenderProps) => (
        <button
            type="button"
            disabled={_b}
            onClick={async () => {
                try {
                    setBusy(true);
                    setMessage(t.netease.fetchingLyrics, "info", 10000);
                    const result = await api.neteaseLyrics(song.id);
                    const lrc = result.lyric || result.tlyric;
                    if (lrc) {
                        onImportText(lrc);
                        toastPubSub.pub({ type: "success", text: t.netease.importedLyrics.replace("{name}", song.label || String(song.id)) });
                    } else {
                        toastPubSub.pub({ type: "warning", text: t.netease.noLyrics });
                    }
                } catch (error) {
                    toastPubSub.pub({ type: "error", text: (error as Error).message });
                } finally {
                    setBusy(false);
                    setMessage("");
                }
            }}
        >
            Fetch Lyrics
        </button>
    );

    return (
        <section className="roller-card lyrics-import-card">
            <h2>{u.importLyrics}</h2>

            <div className="library-strip" role="tablist" aria-label="Lyric libraries">
                <button
                    className={`library-chip ${library === "lrclib" ? "active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={library === "lrclib"}
                    onClick={() => setLibrary("lrclib")}
                >
                    {u.lrclib}
                </button>
                <button
                    className={`library-chip ${library === "netease" ? "active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={library === "netease"}
                    onClick={() => setLibrary("netease")}
                >
                    {u.netease}
                </button>
                <button
                    className={`library-chip ${library === "local" ? "active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={library === "local"}
                    onClick={() => setLibrary("local")}
                >
                    {u.localFiles}
                </button>
            </div>

            {message && <p className={`roller-message ${messageType}${messageFading ? " fading" : ""}`}>{message}</p>}
            {library === "lrclib" && renderLrclib()}
            {library === "netease" && (
                <NeteaseSearch
                    defaultQuery=""
                    meta={{ track: editorMeta.track || project?.metadata.track, artist: editorMeta.artist || project?.metadata.artist, album: editorMeta.album || project?.metadata.album }}
                    onMessage={(text, type, _duration) => { toastPubSub.pub({ type, text }); }}
                    renderResultActions={renderNeteaseActions}
                />
            )}
            {library === "local" && renderLocalFiles()}
        </section>
    );
};
