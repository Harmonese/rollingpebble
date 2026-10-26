import React, { useContext, useEffect, useState } from "react";
import { neteaseResolve, neteaseSearch } from "../../shared/api/lyricsSources.js";
import { backendMessageText } from "../../shared/api/request.js";
import type { NeteaseSong } from "../../shared/api/types.js";
import { appContext, AppContextBits } from "../../shared/appContext.js";
import { formatDuration } from "../../shared/format.js";
import type { MessageType } from "../../shared/messageTypes.js";
import { ButtonGroup, FormGrid, MutedText, SectionTitle } from "../../ui/index.js";

import { useProjectMetadataSeed } from "./useProjectMetadataSeed.js";
import { useRequestScope } from "./useRequestScope.js";

export interface NeteaseSearchMeta {
    track?: string;
    artist?: string;
    album?: string;
}

export interface NeteaseSearchRenderProps {
    song: NeteaseSong;
    busy: boolean;
    isCurrent: () => boolean;
}

interface NeteaseSearchProps {
    panelSessionId: string;
    workspaceId: string;
    defaultQuery: string;
    meta: NeteaseSearchMeta;
    onMessage: (text: string, type: MessageType) => void;
    renderResultActions: (props: NeteaseSearchRenderProps) => React.ReactNode;
}

export const NeteaseSearch: React.FC<NeteaseSearchProps> = (
    { defaultQuery, meta, onMessage, renderResultActions, panelSessionId, workspaceId },
) => {
    const [busy, setBusy] = useState(false);
    const { lang } = useContext(appContext, AppContextBits.lang);
    const t = lang.toast;
    const u = lang.ui;
    const [link, setLink] = useState("");
    const { query, updateQuery } = useProjectMetadataSeed({
        fallbackMeta: meta,
        panelSessionId,
        querySeed: [meta.track, meta.artist].filter(Boolean).join(" ") || defaultQuery,
    });
    const [results, setResults] = useState<NeteaseSong[]>([]);
    const [resultIdentity, setResultIdentity] = useState("");
    const [searched, setSearched] = useState(false);
    const identity = JSON.stringify([panelSessionId, workspaceId, query, link, meta]);
    const scope = useRequestScope(identity);
    const isCurrent = scope.snapshot();
    useEffect(() => {
        setResults([]);
        setSearched(false);
        setBusy(false);
        onMessage("", "info");
    }, [identity]);

    const matchLink = async () => {
        const value = link.trim();
        if (!value) {
            onMessage(t.netease.enterLink, "warning");
            return;
        }
        const valid = scope.begin();
        if (!valid()) return;
        setBusy(true);
        setSearched(true);
        onMessage(t.netease.matching, "info");
        try {
            const response = await neteaseResolve(value);
            if (!valid()) return;
            setResultIdentity(identity);
            setResults([response.song]);
            onMessage(t.netease.oneResult, "success");
        } catch (error) {
            if (valid()) onMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            if (valid()) setBusy(false);
        }
    };

    const search = async () => {
        const q = query.trim();
        if (!q) {
            onMessage(t.netease.enterQuery, "warning");
            return;
        }
        const valid = scope.begin();
        if (!valid()) return;
        setBusy(true);
        setSearched(true);
        onMessage(t.netease.searching, "info");
        try {
            const response = await neteaseSearch({
                query: q,
                track: meta.track,
                artist: meta.artist,
                album: meta.album,
                limit: 20,
            });
            if (!valid()) return;
            setResultIdentity(identity);
            setResults(response.results);
            onMessage(t.netease.results.replace("{n}", String(response.results.length)), "success");
        } catch (error) {
            if (valid()) onMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            if (valid()) setBusy(false);
        }
    };

    return (
        <>
            <SectionTitle>{u.songLink}</SectionTitle>
            <FormGrid>
                <input
                    placeholder="https://music.163.com/#/song?id=..."
                    value={link}
                    onChange={(ev) => setLink(ev.target.value)}
                    onKeyDown={(ev) => {
                        if (ev.key === "Enter") void matchLink();
                    }}
                />
            </FormGrid>
            <ButtonGroup>
                <button type="button" disabled={busy || !link.trim()} onClick={matchLink}>
                    {u.matchLink}
                </button>
            </ButtonGroup>

            <SectionTitle>{u.search}</SectionTitle>
            <FormGrid>
                <input
                    placeholder={u.songTitleAndArtist}
                    value={query}
                    onChange={(ev) => updateQuery(ev.target.value)}
                    onKeyDown={(ev) => {
                        if (ev.key === "Enter") void search();
                    }}
                />
            </FormGrid>
            <ButtonGroup>
                <button type="button" disabled={busy || !query.trim()} onClick={search}>
                    {u.search}
                </button>
            </ButtonGroup>

            <div className="studio-results">
                {searched && results.length === 0 && !busy && <MutedText>{u.noResultsFound}</MutedText>}
                {(resultIdentity === identity ? results : []).map((song) => (
                    <article key={song.id} className="studio-result">
                        <b>{song.label || song.id}</b>
                        <small>{u.id}: {song.id} · {u.durationLabel}: {formatDuration(song.duration)}</small>
                        <ButtonGroup compact>
                            {renderResultActions({ song, busy, isCurrent })}
                        </ButtonGroup>
                    </article>
                ))}
            </div>
        </>
    );
};
