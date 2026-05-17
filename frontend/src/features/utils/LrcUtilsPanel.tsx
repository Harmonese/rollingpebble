import React, { useCallback, useContext, useMemo, useState } from "react";
import { toastPubSub } from "../../components/toast.js";
import { appContext, ChangBits } from "../../components/app.context.js";

function shiftTimestamps(text: string, offsetMs: number): { text: string; count: number } {
    if (!offsetMs) return { text, count: 0 };
    let count = 0;
    const result = text.replace(
        /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g,
        (_match, min: string, sec: string, ms = "0") => {
            count++;
            const totalMs = parseInt(min) * 60_000 + parseInt(sec) * 1_000 + parseInt(ms.padEnd(3, "0"));
            const shifted = totalMs + offsetMs;
            if (shifted < 0) return "[00:00.00]";
            const m = Math.floor(shifted / 60_000);
            const s = Math.floor((shifted % 60_000) / 1_000);
            const c = Math.floor((shifted % 1_000) / 10);
            return `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}]`;
        },
    );
    return { text: result, count };
}

function linearTransform(text: string, a: number, b: number): { text: string; count: number } {
    let count = 0;
    const result = text.replace(
        /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g,
        (_match, min: string, sec: string, ms = "0") => {
            count++;
            const totalMs = parseInt(min) * 60_000 + parseInt(sec) * 1_000 + parseInt(ms.padEnd(3, "0"));
            const transformed = Math.round(a * totalMs + b);
            if (transformed < 0) return "[00:00.00]";
            const m = Math.floor(transformed / 60_000);
            const s = Math.floor((transformed % 60_000) / 1_000);
            const c = Math.floor((transformed % 1_000) / 10);
            return `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}]`;
        },
    );
    return { text: result, count };
}

function removeTags(text: string): { text: string; count: number } {
    const lines = text.split("\n");
    const filtered = lines.filter((line) => !/^\[[a-z_][a-z0-9_]*:/i.test(line.trim()));
    return { text: filtered.join("\n"), count: lines.length - filtered.length };
}

function removeBlankLines(text: string): { text: string; count: number } {
    const hasTrailingNewline = /\r?\n$/.test(text);
    const lines = text.split(/\r?\n/);
    if (hasTrailingNewline) lines.pop();
    const filtered = lines.filter((line) => line.trim() !== "");
    return { text: filtered.join("\n") + (hasTrailingNewline ? "\n" : ""), count: lines.length - filtered.length };
}

function compressTags(text: string): { text: string; count: number } {
    let count = 0;
    const result = text
        .split("\n")
        .map((line) => {
            const trimmed = line.trim();
            if (/^\[[a-z_][a-z0-9_]*:/i.test(trimmed)) {
                const compressed = trimmed.replace(/\s+/g, " ");
                if (compressed !== line) count++;
                return compressed;
            }
            return line;
        })
        .join("\n");
    return { text: result, count };
}

function splitTranslations(text: string): { text: string; count: number } {
    const lines = text.split("\n");
    const result: string[] = [];
    let splitCount = 0;
    for (const line of lines) {
        const match = line.match(/^(\[\d{1,3}:\d{2}(?:\.\d{1,3})?\])/);
        if (!match) {
            result.push(line);
            continue;
        }
        const tag = match[1];
        const content = line.slice(tag.length);
        const parts = content.split(/(?<=\p{L})[  ]{2,}(?=\p{L})/u);
        if (parts.length > 1) {
            for (const part of parts) {
                const trimmed = part.trim();
                if (trimmed) result.push(`${tag}${trimmed}`);
            }
            splitCount++;
        } else {
            result.push(line);
        }
    }
    return { text: result.join("\n"), count: splitCount };
}

export const LrcUtilsPanel: React.FC<{
    open: boolean;
    text: string;
    onClose: () => void;
    onApply: (newText: string) => void;
}> = ({ open, text, onClose, onApply }) => {
    const [offsetMs, setOffsetMs] = useState("0");
    const [transformA, setTransformA] = useState("1");
    const [transformB, setTransformB] = useState("0");
    const [overwriteText, setOverwriteText] = useState("");
    const { lang } = useContext(appContext, ChangBits.lang);
    const tu = lang.toast.utils;
    const u = lang.ui;

    const apply = useCallback(
        (label: string, transform: (t: string) => { text: string; count: number }) => {
            const { text: newText, count } = transform(text);
            if (newText !== text) {
                onApply(newText);
                toastPubSub.pub({ type: "success", text: tu.linesChanged.replace("{label}", label).replace("{count}", String(count)) });
            } else {
                toastPubSub.pub({ type: "info", text: tu.noChanges.replace("{label}", label) });
            }
        },
        [text, onApply],
    );

    const handleOverwrite = useCallback(() => {
        if (!overwriteText.trim()) return;
        const timedLines = text.match(/^\[\d{1,3}:\d{2}(?:\.\d{1,3})?\].*$/gm) || [];
        const overwriteLines = overwriteText.split("\n").filter((l) => l.trim());
        if (overwriteLines.length === 0) return;
        if (timedLines.length === 0) {
            toastPubSub.pub({ type: "warning", text: tu.noTimedLines || "No timed lines found in the current lyrics." });
            return;
        }
        if (overwriteLines.length !== timedLines.length) {
            toastPubSub.pub({ type: "warning", text: tu.lineMismatch.replace("{a}", String(overwriteLines.length)).replace("{b}", String(timedLines.length)) });
        }
        let changed = 0;
        const newLines = timedLines.map((line, i) => {
            const tag = line.match(/^\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/)![0];
            const ow = overwriteLines[i % overwriteLines.length]?.trim();
            if (!ow) return line;
            changed++;
            return `${tag}${ow}`;
        });
        const nonTimed = text.split("\n").filter((l) => !/^\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/.test(l));
        const result = [...newLines, ...(nonTimed.length ? [""] : []), ...nonTimed].join("\n");
        onApply(result);
        toastPubSub.pub({ type: "success", text: tu.overwriteReplaced.replace("{count}", String(changed)) });
    }, [text, overwriteText, onApply]);

    const quickUtils = useMemo(() => [
        { label: tu.compressTags, desc: tu.compressTagsDesc, action: compressTags },
        { label: tu.removeTags, desc: tu.removeTagsDesc, action: removeTags },
        { label: tu.removeBlankLines, desc: tu.removeBlankLinesDesc, action: removeBlankLines },
        { label: tu.splitTranslations, desc: tu.splitTranslationsDesc, action: splitTranslations },
    ], [tu]);

    if (!open) return null;

    return (
        <div className="about-overlay" role="dialog" aria-modal="true" aria-label="LRC Utilities">
            <button className="about-backdrop" type="button" onClick={onClose} />
            <section className="about-modal">
                <div className="about-header">
                    <div>
                        <p className="about-kicker">{u.tools}</p>
                        <h2>{u.lrcUtilities}</h2>
                    </div>
                    <button type="button" onClick={onClose} autoFocus>{u.close}</button>
                </div>

                <div className="lrc-utils-grid">
                    {quickUtils.map((item) => (
                        <button key={item.label} type="button" onClick={() => apply(item.label, item.action)}>
                            <b>{item.label}</b>
                            <small>{item.desc}</small>
                        </button>
                    ))}

                    <label>
                        <b>{tu.timeOffset}</b>
                        <small>{tu.timeOffsetDesc}</small>
                        <span className="utils-input-row">
                            <input
                                type="number"
                                value={offsetMs}
                                onChange={(ev) => setOffsetMs(ev.target.value)}
                                placeholder="0"
                            />
                            <button type="button" onClick={() => apply(`Time Offset (${offsetMs || "0"} ms)`, (t) => shiftTimestamps(t, parseInt(offsetMs) || 0))}>
                                {u.apply}
                            </button>
                        </span>
                    </label>

                    <label>
                        <b>{tu.linearTransform}</b>
                        <small>{tu.linearTransformDesc}</small>
                        <span className="utils-input-row">
                            <span className="transform-expr">
                                f = <input type="number" value={transformA} onChange={(ev) => setTransformA(ev.target.value)} placeholder="1" step="any" />
                                × t + <input type="number" value={transformB} onChange={(ev) => setTransformB(ev.target.value)} placeholder="0" />
                            </span>
                            <button type="button" onClick={() => apply("Linear Transform", (t) => linearTransform(t, parseFloat(transformA) || 1, parseFloat(transformB) || 0))}>
                                {u.apply}
                            </button>
                        </span>
                    </label>

                    <label>
                        <b>{tu.overwriteLyrics}</b>
                        <small>{tu.overwriteLyricsDesc}</small>
                        <textarea
                            value={overwriteText}
                            onChange={(ev) => setOverwriteText(ev.target.value)}
                            placeholder={tu.pastePlaceholder}
                            rows={4}
                        />
                        <button type="button" onClick={handleOverwrite}>{u.apply}</button>
                    </label>
                </div>
            </section>
        </div>
    );
};
