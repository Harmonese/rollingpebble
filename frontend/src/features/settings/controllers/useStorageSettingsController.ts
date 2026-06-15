import { useCallback, useState } from "react";
import { backendMessageText } from "../../../shared/api/request.js";
import {
    migrateStorageRoot as migrateStorageRootApi,
    openModelFolder as openModelFolderApi,
    openOtherFolder as openOtherFolderApi,
    openRuntimeFolder as openRuntimeFolderApi,
    openStorageFolder as openStorageFolderApi,
    storageCleanupPreview,
    storageCleanupRun,
    storageUsage as storageUsageApi,
} from "../../../shared/api/storage.js";
import { selectLocalPath } from "../../../shared/api/settings.js";
import type { StorageCleanupTarget, StorageRoot, StorageUsage } from "../../../shared/api/types.js";
import { formatBytes } from "../../../shared/format.js";
import { toastPubSub } from "../../../ui/Toast.js";
import { saveSettingsPatch, type SettingsControllerContext } from "./settingsControllerUtils.js";

function isOlderThanDays(value: string | null | undefined, days: number): boolean {
    if (days <= 0) return true;
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    return Date.now() - date.getTime() >= days * 86400 * 1000;
}

export function useStorageSettingsController(options: SettingsControllerContext & {
    projectAutoDeleteDays: string;
    setProjectAutoDeleteDays: (value: string) => void;
    refreshRuntime: (notify?: boolean) => Promise<void>;
    tl: (key: string) => string;
}) {
    const { lang, projectAutoDeleteDays, refresh, refreshRuntime, setBusy, setMessage, setProjectAutoDeleteDays, tl } =
        options;
    const t = lang.settings;
    const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
    const [storageOlderThanDays, setStorageOlderThanDays] = useState("1");
    const [storageBusy, setStorageBusy] = useState(false);
    const [storageTargetPaths, setStorageTargetPaths] = useState<Record<string, string>>({});

    const refreshStorage = useCallback(async () => {
        try {
            const usage = await storageUsageApi();
            setStorageUsage(usage);
            setStorageTargetPaths((current) => {
                const next = { ...current };
                usage.roots.forEach((root) => {
                    if (!(root.id in next)) next[root.id] = root.path;
                });
                return next;
            });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        }
    }, [lang.backendMessages, setMessage]);

    const openStorageFolder = async () => {
        setStorageBusy(true);
        try {
            const result = await openStorageFolderApi();
            toastPubSub.pub({ type: "success", text: t.messages.openedFolder.replace("{path}", result.path) });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const browseStorageRoot = async (root: StorageRoot) => {
        if (!root.movable) return;
        setStorageBusy(true);
        try {
            const result = await selectLocalPath({
                mode: "directory",
                title: t.storage.selectStorageLocation.replace("{label}", tl(root.label)),
                initial_path: storageTargetPaths[root.id] || root.path || null,
            });
            if (!result.canceled && result.path) {
                setStorageTargetPaths((current) => ({ ...current, [root.id]: result.path }));
            }
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const migrateStorageRoot = async (root: StorageRoot) => {
        if (!root.movable || !["projects", "models"].includes(root.id)) return;
        const targetPath = (storageTargetPaths[root.id] || "").trim();
        if (!targetPath || targetPath === root.path) {
            setMessage(t.storage.targetUnchanged, "warning");
            return;
        }
        if (
            !window.confirm(
                t.storage.confirmMigrateRoot.replace("{label}", tl(root.label)).replace("{path}", targetPath),
            )
        ) return;
        setStorageBusy(true);
        setMessage(t.storage.migrating, "info");
        try {
            const result = await migrateStorageRootApi({
                root_id: root.id as "projects" | "models",
                target_path: targetPath,
            });
            setStorageUsage(result.usage);
            setStorageTargetPaths((current) => ({ ...current, [root.id]: result.root.path }));
            setMessage("");
            toastPubSub.pub({
                type: "success",
                text: t.storage.migratedRoot.replace("{label}", tl(result.root.label)).replace(
                    "{bytes}",
                    formatBytes(result.moved_bytes),
                ),
            });
            void refreshRuntime();
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const openModelFolder = async (modelId: string) => {
        setStorageBusy(true);
        try {
            const result = await openModelFolderApi(modelId);
            toastPubSub.pub({ type: "success", text: t.messages.openedFolder.replace("{path}", result.path) });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const openRuntimeFolder = async (runtimeId: string) => {
        setStorageBusy(true);
        try {
            const result = await openRuntimeFolderApi(runtimeId);
            toastPubSub.pub({ type: "success", text: t.messages.openedFolder.replace("{path}", result.path) });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const openOtherFolder = async (relativePath: string) => {
        setStorageBusy(true);
        try {
            const result = await openOtherFolderApi(relativePath);
            toastPubSub.pub({ type: "success", text: t.messages.openedFolder.replace("{path}", result.path) });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const runStorageCleanupDirect = async (
        targets: StorageCleanupTarget[],
        options: {
            projectIds?: string[];
            modelIds?: string[];
            runtimeIds?: string[];
            otherPaths?: string[];
            confirmation?: string;
        } = {},
    ) => {
        const projectIds = options.projectIds || [];
        const modelIds = options.modelIds || [];
        const runtimeIds = options.runtimeIds || [];
        const otherPaths = options.otherPaths || [];
        if (
            projectIds.length === 0
            && targets.some((target) => target === "delete_projects" || target === "clear_intermediate")
        ) {
            setMessage(t.messages.noProjectsClean, "warning");
            return;
        }
        if (modelIds.length === 0 && targets.includes("delete_model_items")) {
            setMessage(t.messages.noModelsClean, "warning");
            return;
        }
        if (runtimeIds.length === 0 && targets.includes("clean_runtime_envs")) {
            setMessage(t.messages.noRuntimesDelete, "warning");
            return;
        }
        if (otherPaths.length === 0 && targets.includes("delete_other_items")) {
            setMessage(t.messages.noOtherDelete, "warning");
            return;
        }
        if (options.confirmation && !window.confirm(options.confirmation)) {
            return;
        }
        setStorageBusy(true);
        setMessage(t.messages.cleaning, "info");
        try {
            const plan = await storageCleanupPreview({
                targets,
                project_ids: projectIds,
                model_ids: modelIds,
                runtime_ids: runtimeIds,
                other_paths: otherPaths,
                older_than_days: 0,
            });
            const result = await storageCleanupRun({
                plan_id: plan.plan_id,
                entry_ids: null,
            });
            if (result.usage) setStorageUsage(result.usage);
            const failedText = result.failed.length
                ? ` ${t.messages.failedEntries.replace("{count}", String(result.failed.length))}`
                : "";
            setMessage("");
            toastPubSub.pub({
                type: "success",
                text: t.messages.deletedEntries.replace("{count}", String(result.deleted_count)).replace(
                    "{bytes}",
                    formatBytes(result.deleted_bytes),
                ) + failedText,
            });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setStorageBusy(false);
        }
    };

    const normalizedAutoDeleteDays = Number.isFinite(Number(projectAutoDeleteDays))
        ? Math.max(0, Math.round(Number(projectAutoDeleteDays)))
        : 0;

    const saveProjectAutoDeleteDays = () => {
        setProjectAutoDeleteDays(String(normalizedAutoDeleteDays));
        void saveSettingsPatch({ lang, refresh, setBusy, setMessage }, {
            project_auto_delete_days: normalizedAutoDeleteDays,
        }, t.messages.saved).then(() => refreshStorage());
    };

    const projectOlderThanDays = Number.isFinite(Number(storageOlderThanDays))
        ? Math.max(0, Math.round(Number(storageOlderThanDays)))
        : 0;
    const storageProjects = (storageUsage?.projects || []).filter((project) =>
        isOlderThanDays(project.updated_at, projectOlderThanDays)
    );
    const allStorageProjectIds = storageProjects.filter((project) => !project.active).map((project) =>
        project.project_id
    );
    const allIntermediateProjectIds = storageProjects.filter((project) => !project.active && project.has_intermediate)
        .map((project) => project.project_id);
    const storageModels = storageUsage?.models || [];
    const storageRuntimes = storageUsage?.runtimes || [];
    const storageOtherItems = storageUsage?.other_items || [];
    const externalCacheItem = storageOtherItems.find((item) => item.relative_path === "cache");
    const safeCleanupAvailable =
        (storageUsage?.projects || []).some((project) => !project.active && project.has_intermediate)
        || Boolean(externalCacheItem?.removable);

    return {
        allIntermediateProjectIds,
        allStorageProjectIds,
        browseStorageRoot,
        migrateStorageRoot,
        openModelFolder,
        openOtherFolder,
        openRuntimeFolder,
        openStorageFolder,
        refreshStorage,
        runStorageCleanupDirect,
        safeCleanupAvailable,
        saveProjectAutoDeleteDays,
        setStorageOlderThanDays,
        setStorageTargetPaths,
        storageBusy,
        storageModels,
        storageOlderThanDays,
        storageOtherItems,
        storageProjects,
        storageRuntimes,
        storageTargetPaths,
        storageUsage,
    };
}
