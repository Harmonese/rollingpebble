import LSK from "#const/local_key.json" with { type: "json" };
import SSK from "#const/session_key.json" with { type: "json" };
import STRINGS from "#const/strings.json" with { type: "json" };

export function readLocalText(key: string, fallback = ""): string {
    return localStorage.getItem(key) ?? fallback;
}

export function writeLocalText(key: string, value: string): void {
    localStorage.setItem(key, value);
}

export function removeLocalText(key: string): void {
    localStorage.removeItem(key);
}

export function readSessionText(key: string, fallback = ""): string {
    return sessionStorage.getItem(key) ?? fallback;
}

export function writeSessionText(key: string, value: string): void {
    sessionStorage.setItem(key, value);
}

export function removeSessionText(key: string): void {
    sessionStorage.removeItem(key);
}

export function readSessionNumber(key: string, fallback = 0): number {
    const value = Number.parseInt(readSessionText(key), 10);
    return Number.isFinite(value) ? value : fallback;
}

export const editorStorageKeys = {
    preferences: LSK.preferences,
    lyric: LSK.lyric,
    selectIndex: SSK.selectIndex,
    syncMode: SSK.syncMode,
    editorDetailsOpen: SSK.editorDetailsOpen,
    audioSrc: SSK.audioSrc,
    empty: STRINGS.emptyString,
} as const;
