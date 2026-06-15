import { convertTimeToTag, formatText, stringify, type IFormatOptions, type ILyric, type State as LrcEngineState } from "@lrc-maker/lrc-parser";
import type { Action as LrcEngineAction } from "./useLyricsEngine.js";
import { ActionType, type IState as LrcRuntimeState, useLrc } from "./useLyricsEngine.js";

export type LyricsDocumentState = LrcRuntimeState;
export type LyricsDocumentEngineState = LrcEngineState;
export type LyricsDocumentLine = ILyric;
export type LyricsDocumentAction = LrcEngineAction;
export { ActionType as LyricsDocumentActionType };

export { convertTimeToTag, formatText, useLrc as useLyricsEngine };

export type LyricsDocumentMetadata = {
    track: string;
    artist: string;
    album: string;
    duration: number;
};

export function lyricsDocumentMeta(
    state: LyricsDocumentState,
    fallback?: { metadata: LyricsDocumentMetadata } | null,
): LyricsDocumentMetadata {
    const len = state.info.get("length") || "";
    let duration = 0;
    const match = /^(\d+):(\d+)(?:\.(\d+))?$/.exec(len);
    if (match) {
        duration = Number(match[1]) * 60 + Number(match[2]);
    }
    const current = {
        track: state.info.get("ti") || "",
        artist: state.info.get("ar") || "",
        album: state.info.get("al") || "",
        duration,
    };
    return {
        track: current.track || fallback?.metadata.track || "",
        artist: current.artist || fallback?.metadata.artist || "",
        album: current.album || fallback?.metadata.album || "",
        duration: current.duration || fallback?.metadata.duration || 0,
    };
}

export function lyricsDocumentPlainText(state: LyricsDocumentState): string {
    return state.lyric.map((line) => line.text.trim()).filter(Boolean).join("\n").trim();
}

export function lyricsDocumentSyncedText(
    state: LyricsDocumentState,
    prefState: unknown,
    includeMetadataTags: boolean,
): string {
    const engineState = {
        info: state.info,
        lyric: state.lyric,
    } as LrcEngineState;
    const formatOptions = prefState as IFormatOptions;
    if (includeMetadataTags) {
        return stringify(engineState, formatOptions);
    }
    return stringify({ ...engineState, info: new Map() } as LrcEngineState, formatOptions);
}
