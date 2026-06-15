const METADATA_LINE_RE = /^\s*\[[A-Za-z][A-Za-z0-9_-]{0,31}:[^\]]*\]\s*$/;
const LEADING_TIMESTAMP_RE = /^(?:\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+\s*/;
const TIMESTAMP_RE = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g;

function normalizeNewlines(text: string): string {
    return (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function isLrcMetadataLine(line: string): boolean {
    const trimmed = line.trim();
    return Boolean(trimmed && METADATA_LINE_RE.test(trimmed));
}

export function stripTimestamps(text: string): string {
    return lyricContentOnly(text);
}

export function lyricContentOnly(text: string): string {
    return normalizeNewlines(text)
        .split("\n")
        .map((line) => {
            if (isLrcMetadataLine(line)) return "";
            return line.replace(LEADING_TIMESTAMP_RE, "").replace(TIMESTAMP_RE, "").trim();
        })
        .filter(Boolean)
        .join("\n")
        .trim();
}

export function hasLyricContent(text: string): boolean {
    return lyricContentOnly(text).length > 0;
}

export function buildImportText(record: {
    plain_lyrics?: string;
    synced_lyrics?: string;
    track_name?: string;
    artist_name?: string;
    album_name?: string;
    duration?: number | null;
}): string {
    const header = [
        record.track_name ? `[ti:${record.track_name}]` : "",
        record.artist_name ? `[ar:${record.artist_name}]` : "",
        record.album_name ? `[al:${record.album_name}]` : "",
        record.duration ? `[length:${Math.floor(record.duration / 60).toString().padStart(2, "0")}:${String(record.duration % 60).padStart(2, "0")}.00]` : "",
    ].filter(Boolean);
    const body = record.synced_lyrics || record.plain_lyrics || "";
    return [...header, body].join("\n").trim();
}

export function buildImportTextFromProject(project: {
    plain_lyrics?: string;
    synced_lyrics?: string;
    metadata?: {
        track?: string;
        artist?: string;
        album?: string;
        duration?: number | null;
    };
}): string {
    const meta = project.metadata;
    return buildImportText({
        track_name: meta?.track,
        artist_name: meta?.artist,
        album_name: meta?.album,
        duration: meta?.duration || null,
        plain_lyrics: project.plain_lyrics,
        synced_lyrics: project.synced_lyrics,
    });
}
