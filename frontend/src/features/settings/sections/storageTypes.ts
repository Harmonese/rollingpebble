import type React from "react";
import type { Language } from "../../../languages/index.js";
import type {
    AutoRollerRuntime,
    StorageCleanupTarget,
    StorageModelItem,
    StorageOtherItem,
    StorageProject,
    StorageRoot,
    StorageRuntimeItem,
    StorageUsage,
} from "../../../shared/api/types.js";

export type RunStorageCleanup = (
    targets: StorageCleanupTarget[],
    options?: {
        projectIds?: string[];
        modelIds?: string[];
        runtimeIds?: string[];
        otherPaths?: string[];
        confirmation?: string;
    },
) => void;

export type StorageSettingsProps = {
    title: string;
    t: Language["settings"];
    u: Language["ui"];
    runtime: AutoRollerRuntime | null;
    trOpt: (key: string) => string;
    tl: (key: string) => string;
    storageUsage: StorageUsage | null;
    storageBusy: boolean;
    storageTargetPaths: Record<string, string>;
    setStorageTargetPaths: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    storageOlderThanDays: string;
    setStorageOlderThanDays: (value: string) => void;
    projectAutoDeleteDays: string;
    setProjectAutoDeleteDays: (value: string) => void;
    saveProjectAutoDeleteDays: () => void;
    safeCleanupAvailable: boolean;
    storageProjects: StorageProject[];
    allStorageProjectIds: string[];
    allIntermediateProjectIds: string[];
    storageModels: StorageModelItem[];
    storageRuntimes: StorageRuntimeItem[];
    storageOtherItems: StorageOtherItem[];
    openStorageFolder: () => void;
    browseStorageRoot: (root: StorageRoot) => void;
    migrateStorageRoot: (root: StorageRoot) => void;
    openModelFolder: (modelId: string) => void;
    openRuntimeFolder: (runtimeId: string) => void;
    openOtherFolder: (relativePath: string) => void;
    runStorageCleanupDirect: RunStorageCleanup;
};
