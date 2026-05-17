/**
 * Shared formatting utilities used across feature panels.
 */

export function formatBytes(value?: number | null): string {
    if (value == null || !Number.isFinite(value)) return "unknown";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = Math.max(0, value);
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
    }
    return index === 0 ? `${Math.round(size)} ${units[index]}` : `${size.toFixed(2)} ${units[index]}`;
}

export function formatDuration(seconds: number): string {
    if (!seconds) return "-";
    const minute = Math.floor(seconds / 60);
    const second = Math.round(seconds % 60).toString().padStart(2, "0");
    return `${minute}:${second}`;
}

export function formatDateTime(value?: string | null): string {
    if (!value) return "not available";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function secondsSince(value?: string | null): number | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
}

export function formatLongDuration(seconds: number | null): string {
    if (seconds === null) return "unknown";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}
