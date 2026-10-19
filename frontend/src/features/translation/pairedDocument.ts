import { convertTimeToTag } from "../../domain/lyrics/lyricsDocument.js";
import type { TranslatedLine } from "../../domain/lyrics/translationDocument.js";

export type Side = 0 | 1;
export const stamp = (time: number | undefined, fixed: Fixed) =>
    time === undefined ? "" : convertTimeToTag(time, fixed);
export const pairedText = (lines: readonly TranslatedLine[], side: Side, fixed: Fixed) =>
    lines.map(line => stamp(line.time, fixed) + (side === 0 ? line.text : line.translation || "")).join("\n");

/** Full-line plain-text paste may omit protected timestamps; mismatching tags may not. */
export function translationPaste(text: string, lines: readonly TranslatedLine[], fixed: Fixed) {
    const parts = text.replace(/\r\n?/g, "\n").split("\n");
    if (parts.length !== lines.length) return text;
    return parts.map((part, i) => part.startsWith("[") ? part : stamp(lines[i].time, fixed) + part).join("\n");
}

export function readPair(text: string, side: Side, lines: readonly TranslatedLine[], fixed: Fixed) {
    const parts = text.replace(/\r\n?/g, "\n").split("\n");
    if (!lines.length) return text ? { error: "structure" as const } : { lines: [] };
    if (parts.length !== lines.length) return { error: "structure" as const };
    const next: TranslatedLine[] = [];
    for (let i = 0; i < parts.length; i++) {
        const old = lines[i], value = parts[i];
        if (side === 1) {
            const prefix = stamp(old.time, fixed);
            if (!value.startsWith(prefix)) return { error: "timestamp" as const };
            const translation = value.slice(prefix.length);
            if (/^\[\d+:/.test(translation)) return { error: "timestamp" as const };
            next.push(translation === (old.translation || "") ? old : { ...old, translation, source_text: old.text });
        } else {
            const match = /^\[(\d+):([0-5]\d)(?:\.(\d{1,3}))?\](.*)$/.exec(value);
            if (!match && value.startsWith("[") && (old.time !== undefined || /^\[(?:\d|:|\]|$)/.test(value))) {
                return { error: "timestamp" as const };
            }
            const text = match ? match[4] : value;
            if (/^\[\d+:/.test(text)) return { error: "timestamp" as const };
            const parsed = match
                ? Number(match[1]) * 60 + Number(match[2]) + Number("0." + (match[3] || "0"))
                : undefined;
            // Display precision must not round a timestamp on an unrelated text edit.
            const time = match?.[0].slice(0, match[0].length - text.length) === stamp(old.time, fixed)
                ? old.time
                : parsed;
            if (time !== undefined && !Number.isFinite(time)) return { error: "timestamp" as const };
            next.push({ ...old, time, text });
        }
    }
    return { lines: next };
}

export const pairedHeights = (left: readonly number[], right: readonly number[]) =>
    left.map((height, i) => Math.ceil(Math.max(height, right[i] || 0)));

export function scrollAnchor(heights: readonly number[], top: number) {
    let index = 0, offset = Math.max(0, top);
    while (index < heights.length - 1 && offset >= heights[index]) offset -= heights[index++];
    return { index, fraction: heights[index] ? offset / heights[index] : 0 };
}
export function anchorTop(heights: readonly number[], anchor: { index: number; fraction: number }) {
    return heights.slice(0, anchor.index).reduce((a, b) => a + b, 0) + (heights[anchor.index] || 0) * anchor.fraction;
}
