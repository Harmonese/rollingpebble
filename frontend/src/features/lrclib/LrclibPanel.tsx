import { useEffect, useMemo, useRef, useState } from "react";
import { api, type LyricsRecord, type MetaModel, type ProjectModel } from "../../shared/api.js";
import { buildImportText } from "../../shared/lrc.js";
import { SETTINGS_UPDATED_EVENT } from "../../shared/settingsEvents.js";

const emptyMeta: MetaModel = { track: "", artist: "", album: "", duration: 0 };

type LibraryKind = "lrclib" | "local";

const previewText = (record: LyricsRecord) => {
    const plain = (record.plain_lyrics || "").trim();
    const synced = (record.synced_lyrics || "").trim();
    if (!plain && !synced && record.instrumental) return "Instrumental record. No lyrics text is provided by LRCLIB.";
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
    const [message, setMessage] = useState("");
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
        setMessage("Searching LRCLIB...");
        try {
            const response = await api.lrclibSearch({ query, track: meta.track, artist: meta.artist, album: meta.album, limit: 20 });
            setResults(response.results);
            setMessage(`${response.results.length} result(s).`);
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const doGet = async () => {
        setBusy(true);
        setMessage("Running exact lookup...");
        try {
            const response = await api.lrclibGet(meta);
            setResults(response.record ? [response.record] : []);
            setMessage(response.record ? "1 result(s)." : "0 result(s).");
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const doGetById = async () => {
        if (!Number.isFinite(normalizedId)) return;
        setBusy(true);
        setMessage(`Fetching LRCLIB #${normalizedId}...`);
        try {
            const record = await api.lrclibGetById(normalizedId);
            setResults(record ? [record] : []);
            setMessage(record ? "1 result(s)." : "0 result(s).");
        } catch (error) {
            setMessage((error as Error).message);
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
            setMessage("Imported lyrics.");
        } catch (error) {
            setMessage((error as Error).message);
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
            setMessage(`Loaded ${file.name}.`);
        } catch (error) {
            setMessage((error as Error).message);
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
                setMessage(`Imported ${localFileName || "local lyrics"}.`);
            } else {
                setMessage(`Imported ${localFileName || "local lyrics"} into the editor.`);
            }
        } catch (error) {
            setMessage((error as Error).message);
        }
    };

    const renderLrclib = () => (
        <>
            <div className="roller-form">
                <input placeholder="Title / track" value={meta.track} onChange={(ev) => updateMeta("track", ev.target.value)} />
                <input placeholder="Artist" value={meta.artist} onChange={(ev) => updateMeta("artist", ev.target.value)} />
                <input placeholder="Album" value={meta.album} onChange={(ev) => updateMeta("album", ev.target.value)} />
                <input placeholder="Duration seconds" value={meta.duration || ""} onChange={(ev) => updateMeta("duration", ev.target.value)} />
                <input placeholder="Optional search query" value={query} onChange={(ev) => setQuery(ev.target.value)} />
                <input placeholder="LRCLIB ID" value={lrclibId} onChange={(ev) => setLrclibId(ev.target.value)} inputMode="numeric" />
            </div>
            <div className="roller-actions">
                <button type="button" disabled={busy || (!query && !meta.track)} onClick={doSearch}>Search</button>
                <button type="button" disabled={busy || !meta.track || !meta.artist} onClick={doGet}>Exact Lookup</button>
                <button type="button" disabled={busy || !Number.isFinite(normalizedId)} onClick={doGetById}>Fetch by LRCLIB ID</button>
            </div>
            <div className="roller-results">
                {results.map((record, index) => (
                    <article key={`${record.id || index}-${record.label}`} className="roller-result">
                        <b>{record.label || `${record.artist_name} - ${record.track_name}`}</b>
                        <small>ID: {record.id || "unknown"} · plain: {record.has_plain ? "yes" : "no"} · synced: {record.has_synced ? "yes" : "no"} · instrumental: {record.instrumental ? "yes" : "no"}</small>
                        <details className="result-preview">
                            <summary>Preview</summary>
                            <pre className="lyric-preview">{previewText(record)}</pre>
                        </details>
                        <div className="roller-actions compact">
                            <button type="button" disabled={!record.has_plain} onClick={() => importRecord(record, "plain")}>Import plain</button>
                            <button type="button" disabled={!record.has_synced} onClick={() => importRecord(record, "synced")}>Import synced</button>
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
                    <b>Import Lyrics</b>
                    <small>Load .lrc or .txt.</small>
                </span>
            </button>
            {localFileName && <p className="roller-muted">Selected: {localFileName}</p>}
            <textarea
                className="local-lyrics-preview"
                placeholder="Local lyrics input"
                value={localText}
                onChange={(ev) => setLocalText(ev.target.value)}
            />
            <div className="roller-actions">
                <button type="button" disabled={!localText.trim()} onClick={importLocalText}>Import</button>
            </div>
        </div>
    );

    return (
        <section className="roller-card lyrics-import-card">
            <h2>Lyrics Import</h2>

            <div className="library-strip" role="tablist" aria-label="Lyric libraries">
                <button
                    className={`library-chip ${library === "lrclib" ? "active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={library === "lrclib"}
                    onClick={() => setLibrary("lrclib")}
                >
                    LRCLIB
                </button>
                <button
                    className={`library-chip ${library === "local" ? "active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={library === "local"}
                    onClick={() => setLibrary("local")}
                >
                    Local Files
                </button>
            </div>

            {message && <p className="roller-message">{message}</p>}
            {library === "lrclib" ? renderLrclib() : renderLocalFiles()}
        </section>
    );
};
