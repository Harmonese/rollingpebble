import { useContext, useMemo, useRef, useState } from "react";
import { appContext, AppContextBits } from "../../shared/appContext.js";
import { ButtonGroup, FormGrid, Message, MutedText, Panel, Tabs } from "../../ui/index.js";

import { toastPubSub } from "../../ui/Toast.js";
import { useProjectMetadataSeed } from "../shared/useProjectMetadataSeed.js";
import { useMessage } from "../../hooks/useMessage.js";
import type { Language } from "../../languages/index.js";
import { lrclibGet, lrclibGetById, lrclibSearch, neteaseLyrics } from "../../shared/api/lyricsSources.js";
import { applyLyrics } from "../../shared/api/projects.js";
import { backendMessageText } from "../../shared/api/request.js";
import type { LyricsRecord, MetaModel, ProjectModel } from "../../shared/api/types.js";
import { buildImportText } from "../../shared/lrc.js";
import { NeteaseSearch } from "../shared/NeteaseSearch.js";
import type { NeteaseSearchRenderProps } from "../shared/NeteaseSearch.js";

type LibraryKind = "lrclib" | "local" | "netease";

const previewText = (record: LyricsRecord, u: Language["ui"]) => {
    const plain = (record.plain_lyrics || "").trim();
    const synced = (record.synced_lyrics || "").trim();
    if (!plain && !synced && record.instrumental) return u.instrumentalNoLyrics;
    if (!plain && !synced) return u.noLyricText;
    return [
        synced ? `[${u.synced}]\n${synced}` : "",
        plain ? `[${u.plain}]\n${plain}` : "",
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
    const [query, setQuery] = useState("");
    const { meta, updateMeta } = useProjectMetadataSeed({ project, fallbackMeta: editorMeta, updateQuery: setQuery });
    const [lrclibId, setLrclibId] = useState("");
    const [results, setResults] = useState<LyricsRecord[]>([]);
    const [searched, setSearched] = useState(false);
    const [message, setMessage, , messageFading, messageType, messageKey] = useMessage();
    const { lang } = useContext(appContext, AppContextBits.lang);
    const t = lang.toast;
    const u = lang.ui;
    const [busy, setBusy] = useState(false);
    const [localFileName, setLocalFileName] = useState("");
    const [localText, setLocalText] = useState("");
    const localInputRef = useRef<HTMLInputElement | null>(null);

    const normalizedId = useMemo(() => Number.parseInt(lrclibId.trim(), 10), [lrclibId]);

    const doSearch = async () => {
        setBusy(true);
        setSearched(true);
        setMessage(t.lrclib.searching, "info");
        try {
            const response = await lrclibSearch({
                query,
                track: meta.track,
                artist: meta.artist,
                album: meta.album,
                limit: 20,
            });
            setResults(response.results);
            setMessage("");
            toastPubSub.pub({
                type: "success",
                text: t.lrclib.results.replace("{n}", String(response.results.length)),
            });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    const doGet = async () => {
        setBusy(true);
        setSearched(true);
        setMessage(t.lrclib.exactLookup, "info");
        try {
            const response = await lrclibGet(meta);
            setResults(response.record ? [response.record] : []);
            setMessage("");
            toastPubSub.pub({ type: "success", text: t.lrclib.results.replace("{n}", response.record ? "1" : "0") });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    const doGetById = async () => {
        if (!Number.isFinite(normalizedId)) return;
        setBusy(true);
        setSearched(true);
        setMessage(t.lrclib.fetching.replace("{id}", String(normalizedId)), "info");
        try {
            const record = await lrclibGetById(normalizedId);
            setResults(record ? [record] : []);
            setMessage("");
            toastPubSub.pub({ type: "success", text: t.lrclib.results.replace("{n}", record ? "1" : "0") });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
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
                const updated = await applyLyrics(project.project_id, payload);
                onProject(updated, false);
            }
            toastPubSub.pub({ type: "success", text: t.lrclib.imported });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
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
            setMessage(backendMessageText(error, lang.backendMessages), "error");
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
                const updated = await applyLyrics(project.project_id, {
                    metadata: meta,
                    plain_lyrics: synced ? "" : text,
                    synced_lyrics: synced ? text : "",
                    source: "local file",
                    lrclib_id: null,
                });
                onProject(updated, false);
                toastPubSub.pub({
                    type: "success",
                    text: t.lrclib.importedLocal.replace("{name}", localFileName || "local lyrics"),
                });
            } else {
                toastPubSub.pub({
                    type: "success",
                    text: t.lrclib.importedEditor.replace("{name}", localFileName || "local lyrics"),
                });
            }
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        }
    };

    const searchOnEnter = (ev: React.KeyboardEvent) => {
        if (ev.key === "Enter" && !busy && (query || meta.track)) {
            doSearch();
        }
    };

    const renderLrclib = () => (
        <>
            <FormGrid>
                <input
                    placeholder={u.titleTrack}
                    value={meta.track}
                    onChange={(ev) => updateMeta("track", ev.target.value)}
                    onKeyDown={searchOnEnter}
                />
                <input
                    placeholder={u.artist}
                    value={meta.artist}
                    onChange={(ev) => updateMeta("artist", ev.target.value)}
                    onKeyDown={searchOnEnter}
                />
                <input
                    placeholder={u.album}
                    value={meta.album}
                    onChange={(ev) => updateMeta("album", ev.target.value)}
                    onKeyDown={searchOnEnter}
                />
                <input
                    placeholder={u.duration}
                    value={meta.duration || ""}
                    onChange={(ev) => updateMeta("duration", ev.target.value)}
                    onKeyDown={searchOnEnter}
                />
                <input
                    placeholder={u.searchPlaceholder}
                    value={query}
                    onChange={(ev) => setQuery(ev.target.value)}
                    onKeyDown={searchOnEnter}
                />
                <input
                    placeholder={u.lrclibId}
                    value={lrclibId}
                    onChange={(ev) => setLrclibId(ev.target.value)}
                    inputMode="numeric"
                    onKeyDown={(ev) => {
                        if (ev.key === "Enter" && !busy && Number.isFinite(normalizedId)) doGetById();
                    }}
                />
            </FormGrid>
            <ButtonGroup>
                <button type="button" disabled={busy || (!query && !meta.track)} onClick={doSearch}>{u.search}</button>
                <button type="button" disabled={busy || !meta.track || !meta.artist} onClick={doGet}>
                    {u.exactLookup}
                </button>
                <button type="button" disabled={busy || !Number.isFinite(normalizedId)} onClick={doGetById}>
                    {u.fetchById}
                </button>
            </ButtonGroup>
            <div className="studio-results">
                {searched && results.length === 0 && !busy && <MutedText>{u.noResultsFound}</MutedText>}
                {results.map((record, index) => (
                    <article key={`${record.id || index}-${record.label}`} className="studio-result">
                        <b>{record.label || `${record.artist_name} - ${record.track_name}`}</b>
                        <small>
                            {u.id}: {record.id || u.unknownId} · {u.plain}: {record.has_plain ? u.yes : u.no} ·{" "}
                            {u.synced}: {record.has_synced ? u.yes : u.no} · {u.instrumental}:{" "}
                            {record.instrumental ? u.yes : u.no}
                        </small>
                        <details className="result-preview">
                            <summary>{u.preview}</summary>
                            <pre className="lyric-preview">{previewText(record, u)}</pre>
                        </details>
                        <ButtonGroup compact>
                            <button
                                type="button"
                                disabled={!record.has_plain}
                                onClick={() =>
                                    importRecord(record, "plain")}
                            >
                                {u.importPlain}
                            </button>
                            <button
                                type="button"
                                disabled={!record.has_synced}
                                onClick={() =>
                                    importRecord(record, "synced")}
                            >
                                {u.importSynced}
                            </button>
                        </ButtonGroup>
                    </article>
                ))}
            </div>
        </>
    );

    const renderLocalFiles = () => (
        <div className="local-file-import">
            <input
                ref={localInputRef}
                className="studio-hidden-file"
                type="file"
                accept=".lrc,.txt,text/plain,text/*"
                onChange={onLocalFile}
            />
            <button
                className="studio-import-button compact-import"
                type="button"
                onClick={() => localInputRef.current?.click()}
            >
                <span className="studio-import-icon">+</span>
                <span>
                    <b>{u.importLyrics}</b>
                    <small>{u.importLyricsDesc}</small>
                </span>
            </button>
            {localFileName && <MutedText>{u.selectedFile.replace("{name}", localFileName)}</MutedText>}
            <textarea
                className="local-lyrics-preview"
                placeholder={u.localLyricsInput}
                value={localText}
                onChange={(ev) => setLocalText(ev.target.value)}
            />
            <ButtonGroup>
                <button type="button" disabled={!localText.trim()} onClick={importLocalText}>{u.import}</button>
            </ButtonGroup>
        </div>
    );

    const renderNeteaseActions = ({ song, busy: _b }: NeteaseSearchRenderProps) => (
        <button
            type="button"
            disabled={_b}
            onClick={async () => {
                try {
                    setBusy(true);
                    setMessage(t.netease.fetchingLyrics, "info");
                    const result = await neteaseLyrics(song.id);
                    const lrc = result.lyric || result.tlyric;
                    if (lrc) {
                        onImportText(lrc);
                        setMessage("");
                        toastPubSub.pub({
                            type: "success",
                            text: t.netease.importedLyrics.replace("{name}", song.label || String(song.id)),
                        });
                    } else {
                        setMessage(t.netease.noLyrics, "warning");
                    }
                } catch (error) {
                    setMessage(backendMessageText(error, lang.backendMessages), "error");
                } finally {
                    setBusy(false);
                }
            }}
        >
            {u.fetchLyrics}
        </button>
    );

    return (
        <Panel title={u.importLyrics} className="lyrics-import-card">

            <Tabs
                ariaLabel="Lyric libraries"
                items={[{ value: "lrclib", label: u.lrclib }, { value: "netease", label: u.netease }, {
                    value: "local",
                    label: u.localFiles,
                }]}
                value={library}
                onChange={setLibrary}
            />

            <Message message={message} type={messageType} fading={messageFading} messageKey={messageKey} />
            {library === "lrclib" && renderLrclib()}
            {library === "netease" && (
                <NeteaseSearch
                    defaultQuery=""
                    meta={{
                        track: editorMeta.track || project?.metadata.track,
                        artist: editorMeta.artist || project?.metadata.artist,
                        album: editorMeta.album || project?.metadata.album,
                    }}
                    onMessage={setMessage}
                    renderResultActions={renderNeteaseActions}
                />
            )}
            {library === "local" && renderLocalFiles()}
        </Panel>
    );
};
