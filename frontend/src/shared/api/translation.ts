import { request } from "./request.js";
export type TranslationConnection = {
    base_url: string;
    model: string;
    prompt: string;
    default_prompt: string;
    proxy: string;
    has_key: boolean;
    key_persistent: boolean;
};
export type TranslationJob = {
    id: string;
    status: "running" | "cancelling" | "canceled" | "failed" | "succeeded";
    error: string | null;
    result: { id: string; text: string }[] | null;
};
export type TranslationInput = {
    request_id: string;
    workspace_id: string;
    revision: string;
    source_language: string;
    target_language: string;
    lines: { id: string; text: string }[];
    selected_ids?: string[];
    title: string;
    artist: string;
    album: string;
};
const write = <T>(path: string, body: unknown, method = "POST") =>
    request<T>("/api/translation/" + path, {
        method,
        headers: { "X-RollingPebble-Client": "translation" },
        body: JSON.stringify(body),
    });
export const translationConnection = () => request<TranslationConnection>("/api/translation/connection");
export const saveTranslationConnection = (body: Partial<TranslationConnection> & { api_key?: string }) =>
    write<TranslationConnection>("connection", body, "PUT");
export const startTranslation = (body: TranslationInput, test = false) =>
    write<TranslationJob>(test ? "test" : "jobs", body);
export const getTranslation = (id: string) => request<TranslationJob>(`/api/translation/jobs/${id}`);
export const cancelTranslation = (id: string) => write<TranslationJob>(`jobs/${id}/cancel`, {});
export const openTranslationSettings = () => window.dispatchEvent(new Event("rollingpebble:translation-settings"));
