import { request } from "./request.js";
import type { HealthResponse, RuntimeSettings } from "./types.js";

export const health = (): Promise<HealthResponse> => request<HealthResponse>("/api/health");

export const selectLocalPath = (
    payload: { mode?: "file" | "directory"; title?: string; initial_path?: string | null },
): Promise<{ path: string; canceled: boolean }> =>
    request<{ path: string; canceled: boolean }>("/api/local/select-path", {
        method: "POST",
        body: JSON.stringify(payload),
    });

let settingsPromise: Promise<RuntimeSettings> | null = null;

export function clearSettingsCache(): void {
    settingsPromise = null;
}

export function settings(): Promise<RuntimeSettings> {
    settingsPromise ??= request<RuntimeSettings>("/api/settings").finally(() => {
        window.setTimeout(() => {
            settingsPromise = null;
        }, 0);
    });
    return settingsPromise;
}

export const updateSettings = (payload: Partial<RuntimeSettings>): Promise<RuntimeSettings> => {
    clearSettingsCache();
    return request<RuntimeSettings>("/api/settings", { method: "POST", body: JSON.stringify(payload) });
};

export const resetSettingsDefaults = (): Promise<RuntimeSettings> => {
    clearSettingsCache();
    return request<RuntimeSettings>("/api/settings/reset-defaults", { method: "POST" });
};

export function uploadWorkspaceBg(file: File): Promise<Response> {
    const form = new FormData();
    form.append("bg", file);
    return fetch("/api/settings/workspace-bg", { method: "POST", body: form });
}

export const deleteWorkspaceBg = (): Promise<{ ok: string }> =>
    request<{ ok: string }>("/api/settings/workspace-bg", { method: "DELETE" });

export type WorkspaceBgStatus = {
    available: boolean;
    custom?: boolean;
    source?: "custom" | "default" | "none";
};

export const workspaceBgStatus = (): Promise<WorkspaceBgStatus> =>
    request<WorkspaceBgStatus>("/api/settings/workspace-bg/status");

export const workspaceBgUrl = (): string => "/api/settings/workspace-bg";
