import { formatBytes } from "../../../shared/format.js";
import { ButtonGroup, MessageText } from "../../../ui/index.js";
import type { StorageSettingsProps } from "./storageTypes.js";

export const StorageRuntimesSection: React.FC<Pick<
    StorageSettingsProps,
    "openRuntimeFolder" | "runStorageCleanupDirect" | "storageBusy" | "storageRuntimes" | "t" | "trOpt" | "u"
>> = ({ openRuntimeFolder, runStorageCleanupDirect, storageBusy, storageRuntimes, t, trOpt, u }) => (
    <details>
        <summary>{t.storage.runtimeEnvs}</summary>
        <ButtonGroup className="storage-actions">
            <button
                className="danger-action"
                type="button"
                disabled={storageBusy || storageRuntimes.every((item) => !item.removable)}
                onClick={() =>
                    runStorageCleanupDirect(["clean_runtime_envs"], {
                        runtimeIds: storageRuntimes.filter((item) => item.removable).map((item) => item.runtime_id),
                        confirmation: t.storage.confirmDeleteRuntimes,
                    })}
            >
                {t.storage.deleteInactiveRuntimes}
            </button>
        </ButtonGroup>
        <div className="storage-item-list">
            {storageRuntimes.length === 0 && <MessageText>{t.storage.noRuntimes}</MessageText>}
            {storageRuntimes.map((item) => (
                <div className="storage-item-row" key={item.runtime_id}>
                    <div className="storage-project-main">
                        <b>{item.runtime_id}{item.active ? ` · ${t.storage.active}` : ""}</b>
                        <small>
                            {item.profile || t.storage.profile} · {trOpt(item.status)}
                            {item.pyroller_version ? ` · py-roller ${item.pyroller_version}` : ""}
                            {item.python_version ? ` · Python ${item.python_version}` : ""}
                        </small>
                        <div className="storage-project-breakdown">
                            <span>{formatBytes(item.bytes)}</span>
                            <span>{u.filesUnit.replace("{n}", String(item.file_count))}</span>
                        </div>
                    </div>
                    <div className="storage-project-actions">
                        <button
                            type="button"
                            disabled={storageBusy}
                            onClick={() => openRuntimeFolder(item.runtime_id)}
                        >
                            {t.common.openFolder}
                        </button>
                        <button
                            className="danger-action"
                            type="button"
                            disabled={storageBusy || !item.removable}
                            onClick={() =>
                                runStorageCleanupDirect(["clean_runtime_envs"], {
                                    runtimeIds: [item.runtime_id],
                                    confirmation: t.storage.confirmDeleteRuntime.replace("{id}", item.runtime_id),
                                })}
                        >
                            {t.common.delete}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    </details>
);
