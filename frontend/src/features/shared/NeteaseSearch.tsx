import React, { useContext, useMemo, useState } from "react";
import { api, backendMessageText, type NeteaseSong } from "../../shared/api.js";
import { appContext, ChangBits } from "../../components/app.context.js";
import { formatDuration } from "../../shared/format.js";
import type { MessageType } from "../../hooks/useMessage.js";

export interface NeteaseSearchMeta {
    track?: string;
    artist?: string;
    album?: string;
}

export interface NeteaseSearchRenderProps {
    song: NeteaseSong;
    busy: boolean;
}

interface NeteaseSearchProps {
    defaultQuery: string;
    meta: NeteaseSearchMeta;
    onMessage: (text: string, type: MessageType) => void;
    renderResultActions: (props: NeteaseSearchRenderProps) => React.ReactNode;
}

export const NeteaseSearch: React.FC<NeteaseSearchProps> = ({ defaultQuery, meta, onMessage, renderResultActions }) => {
    const [busy, setBusy] = useState(false);
    const { lang } = useContext(appContext, ChangBits.lang);
    const t = lang.toast;
    const u = lang.ui;
    const [link, setLink] = useState("");
    const [query, setQuery] = useState(
        () => [meta.track, meta.artist].filter(Boolean).join(" ") || defaultQuery,
    );
    const [results, setResults] = useState<NeteaseSong[]>([]);
    const [searched, setSearched] = useState(false);

    const placeholderQuery = useMemo(() => {
        return [meta.track, meta.artist].filter(Boolean).join(" ") || defaultQuery;
    }, [defaultQuery, meta.artist, meta.track]);

    const matchLink = async () => {
        const value = link.trim();
        if (!value) {
            onMessage(t.netease.enterLink, "warning");
            return;
        }
        setBusy(true);
        setSearched(true);
        onMessage(t.netease.matching, "info");
        try {
            const response = await api.neteaseResolve(value);
            setResults([response.song]);
            onMessage(t.netease.oneResult, "success");
        } catch (error) {
            onMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    const search = async () => {
        const q = (query || placeholderQuery).trim();
        if (!q) {
            onMessage(t.netease.enterQuery, "warning");
            return;
        }
        setBusy(true);
        setSearched(true);
        onMessage(t.netease.searching, "info");
        try {
            const response = await api.neteaseSearch({
                query: q,
                track: meta.track,
                artist: meta.artist,
                album: meta.album,
                limit: 20,
            });
            setResults(response.results);
            onMessage(t.netease.results.replace("{n}", String(response.results.length)), "success");
        } catch (error) {
            onMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <div className="roller-section-title">{u.songLink}</div>
            <div className="roller-form">
                <input
                    placeholder="https://music.163.com/#/song?id=..."
                    value={link}
                    onChange={(ev) => setLink(ev.target.value)}
                    onKeyDown={(ev) => {
                        if (ev.key === "Enter") void matchLink();
                    }}
                />
            </div>
            <div className="roller-actions">
                <button type="button" disabled={busy || !link.trim()} onClick={matchLink}>
                    {u.matchLink}
                </button>
            </div>

            <div className="roller-section-title">{u.search}</div>
            <div className="roller-form">
                <input
                    placeholder={placeholderQuery || u.songTitleAndArtist}
                    value={query}
                    onChange={(ev) => setQuery(ev.target.value)}
                    onKeyDown={(ev) => {
                        if (ev.key === "Enter") void search();
                    }}
                />
            </div>
            <div className="roller-actions">
                <button type="button" disabled={busy || !(query.trim() || placeholderQuery)} onClick={search}>
                    {u.search}
                </button>
            </div>

            <div className="roller-results">
                {searched && results.length === 0 && !busy && <p className="roller-muted">{u.noResultsFound}</p>}
                {results.map((song) => (
                    <article key={song.id} className="roller-result">
                        <b>{song.label || song.id}</b>
                        <small>{u.id}: {song.id} · {u.durationLabel}: {formatDuration(song.duration)}</small>
                        <div className="roller-actions compact">
                            {renderResultActions({ song, busy })}
                        </div>
                    </article>
                ))}
            </div>
        </>
    );
};
