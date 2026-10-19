import { request } from "./request.js";

export type StorageUsage = {
    data_dir: string;
    total_bytes: number;
    migration: { status: "idle" | "moving" | "failed"; target?: string };
    categories: { id: "projects" | "models" | "results" | "cache" | "components"; bytes: number }[];
    projects: { project_id: string; title: string; artist: string; total_bytes: number }[];
};
export const storageUsage = () => request<StorageUsage>("/api/storage/usage");
export const openStorageFolder = () => request("/api/storage/open-folder", { method: "POST" });
export const clearStorageCache = () => request<StorageUsage>("/api/storage/cache/clear", { method: "POST" });
export const relocateStorage = (path: string) =>
    request<StorageUsage>("/api/storage/relocate", {
        method: "POST",
        body: JSON.stringify({ path }),
    });
