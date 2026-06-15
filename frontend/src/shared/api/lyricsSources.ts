import { request } from "./request.js";
import type { LyricsRecord, MetaModel, NeteaseLyricResponse, NeteaseSong } from "./types.js";

export const lrclibSearch = (payload: Record<string, unknown>): Promise<{ results: LyricsRecord[] }> =>
    request<{ results: LyricsRecord[] }>("/api/lrclib/search", { method: "POST", body: JSON.stringify(payload) });

export const lrclibGet = (
    payload: MetaModel,
): Promise<{ record: LyricsRecord | null; duration_diff?: number | null; duration_ok: boolean; source: string }> =>
    request<{ record: LyricsRecord | null; duration_diff?: number | null; duration_ok: boolean; source: string }>(
        "/api/lrclib/get",
        { method: "POST", body: JSON.stringify(payload) },
    );

export const lrclibGetById = (lrclib_id: number): Promise<LyricsRecord | null> =>
    request<LyricsRecord | null>("/api/lrclib/id", { method: "POST", body: JSON.stringify({ lrclib_id }) });

export const neteaseSearch = (
    payload: { query?: string; track?: string; artist?: string; album?: string; limit?: number },
): Promise<{ results: NeteaseSong[] }> =>
    request<{ results: NeteaseSong[] }>("/api/netease/search", { method: "POST", body: JSON.stringify(payload) });

export const neteaseResolve = (value: string): Promise<{ song: NeteaseSong }> =>
    request<{ song: NeteaseSong }>("/api/netease/resolve", { method: "POST", body: JSON.stringify({ value }) });

export const neteaseLyrics = (songId: number): Promise<NeteaseLyricResponse> =>
    request<NeteaseLyricResponse>(`/api/netease/lyrics/${songId}`);
