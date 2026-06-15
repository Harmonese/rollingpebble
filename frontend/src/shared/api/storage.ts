import { request } from "./request.js";
import type {
    StorageCleanupPlan,
    StorageCleanupRunResult,
    StorageCleanupTarget,
    StorageMigrateRootResult,
    StorageUsage,
} from "./types.js";

export const storageUsage = (): Promise<StorageUsage> => request<StorageUsage>("/api/storage/usage");

export const storageCleanupPreview = (
    payload: {
        targets: StorageCleanupTarget[];
        older_than_days?: number | null;
        project_ids?: string[];
        model_ids?: string[];
        runtime_ids?: string[];
        other_paths?: string[];
    },
): Promise<StorageCleanupPlan> =>
    request<StorageCleanupPlan>("/api/storage/cleanup/preview", { method: "POST", body: JSON.stringify(payload) });

export const openStorageFolder = (): Promise<{ status: string; path: string }> =>
    request<{ status: string; path: string }>("/api/storage/open-folder", { method: "POST" });

export const migrateStorageRoot = (
    payload: { root_id: "projects" | "models" | "cache"; target_path: string },
): Promise<StorageMigrateRootResult> =>
    request<StorageMigrateRootResult>("/api/storage/migrate-root", { method: "POST", body: JSON.stringify(payload) });

export const openModelFolder = (modelId: string): Promise<{ status: string; path: string }> =>
    request<{ status: string; path: string }>("/api/storage/models/open-folder", {
        method: "POST",
        body: JSON.stringify({ model_id: modelId }),
    });

export const openRuntimeFolder = (runtimeId: string): Promise<{ status: string; path: string }> =>
    request<{ status: string; path: string }>("/api/storage/runtimes/open-folder", {
        method: "POST",
        body: JSON.stringify({ runtime_id: runtimeId }),
    });

export const openOtherFolder = (relativePath: string): Promise<{ status: string; path: string }> =>
    request<{ status: string; path: string }>("/api/storage/other/open-folder", {
        method: "POST",
        body: JSON.stringify({ relative_path: relativePath }),
    });

export const storageCleanupRun = (
    payload: { plan_id: string; entry_ids?: string[] | null },
): Promise<StorageCleanupRunResult> =>
    request<StorageCleanupRunResult>("/api/storage/cleanup/run", { method: "POST", body: JSON.stringify(payload) });
