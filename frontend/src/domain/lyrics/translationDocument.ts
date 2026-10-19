export type TranslatedLine = {
    id?: string;
    text: string;
    time?: number;
    translation?: string;
    source_text?: string;
};
export type LyricDocument = {
    version: 1;
    source_lrc: string;
    target_language: string;
    lines: TranslatedLine[];
};
export const identify = (line: TranslatedLine): TranslatedLine => ({ ...line, id: line.id || crypto.randomUUID() });
export const hasTranslation = (lines: readonly TranslatedLine[]) => lines.some(line => Boolean(line.translation));
export const translationIdentity = (lines: readonly TranslatedLine[], target = "") =>
    JSON.stringify([
        target,
        lines.map(line => [line.id, line.text, line.translation || "", line.source_text || ""]),
    ]);

// Only preserve identities that can be established without semantic guessing.
export function reconcileLines(before: readonly TranslatedLine[], after: readonly TranslatedLine[]) {
    const assignments = new Map<number, number>();
    const used = new Set<number>();
    const assign = (a: number, b: number) => {
        assignments.set(b, a);
        used.add(a);
    };
    if (before.length === after.length && before.every((line, i) => line.text === after[i].text)) {
        const occurrenceOrder = after.map(line =>
            before.map((old, i) => old.text === line.text && old.time === line.time ? i : -1).filter(i => i >= 0)
        );
        const reordered = occurrenceOrder.every(indices => indices.length === 1)
            && new Set(occurrenceOrder.map(indices => indices[0])).size === before.length;
        before.forEach((_, i) => assign(reordered ? occurrenceOrder[i][0] : i, i));
    } else {
        // Unique unchanged sentences may move. Repeated sentences are safe only
        // when their timestamps identify the occurrence uniquely on both sides.
        after.forEach((line, b) => {
            const candidates = before.map((old, a) => old.text === line.text ? a : -1).filter(a => a >= 0);
            const count = after.filter(other => other.text === line.text).length;
            if (candidates.length === 1 && count === 1) assign(candidates[0], b);
            else if (line.time !== undefined) {
                const timed = candidates.filter(a => before[a].time === line.time);
                if (
                    timed.length === 1
                    && after.filter(other => other.text === line.text && other.time === line.time).length === 1
                ) assign(timed[0], b);
            }
        });
        // A single unmatched pair bounded by matching neighbours is a direct edit.
        const oldRest = before.map((_, i) => i).filter(i => !used.has(i));
        const newRest = after.map((_, i) => i).filter(i => !assignments.has(i));
        if (
            oldRest.length === 1 && newRest.length === 1 && oldRest[0] === newRest[0]
            && [...assignments].every(([b, a]) => a === b)
        ) assign(oldRest[0], newRest[0]);
    }
    const lost = before.filter((line, i) => !used.has(i) && line.translation).length;
    return {
        lost,
        lines: after.map((line, b) => {
            const a = assignments.get(b);
            return identify(a === undefined ? line : { ...before[a], ...line, id: before[a].id });
        }),
    };
}

export function restoreDocument(
    document: LyricDocument | null | undefined,
    source: string,
    lines: readonly TranslatedLine[],
) {
    const normalizeNewlines = (text: string) => text.replace(/\r\n?/g, "\n");
    if (
        !document || document.version !== 1 || normalizeNewlines(document.source_lrc) !== normalizeNewlines(source)
        || document.lines.length !== lines.length || document.lines.some((line, i) => line.text !== lines[i].text)
        || document.lines.some(line => !line.id) || new Set(document.lines.map(line => line.id)).size !== lines.length
    ) return null;
    return document.lines.map((line, i) => ({ ...line, time: lines[i].time }));
}
