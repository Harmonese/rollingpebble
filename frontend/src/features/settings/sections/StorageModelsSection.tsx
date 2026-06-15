import { formatBytes } from "../../../shared/format.js";
import { ButtonGroup, MessageText } from "../../../ui/index.js";
import type { StorageSettingsProps } from "./storageTypes.js";

export const StorageModelsSection: React.FC<Pick<
    StorageSettingsProps,
    "openModelFolder" | "runStorageCleanupDirect" | "storageBusy" | "storageModels" | "t" | "tl" | "u"
>> = ({ openModelFolder, runStorageCleanupDirect, storageBusy, storageModels, t, tl, u }) => (
    <details>
        <summary>{t.storage.models}</summary>
        <ButtonGroup className="storage-actions">
            <button
                className="danger-action"
                type="button"
                disabled={storageBusy || storageModels.length === 0 || storageModels.some((item) => item.active)}
                onClick={() =>
                    runStorageCleanupDirect(["delete_model_items"], {
                        modelIds: storageModels.map((item) => item.id),
                        confirmation: t.storage.confirmDeleteModels.replace("{count}", String(storageModels.length)),
                    })}
            >
                {t.storage.deleteAllModels}
            </button>
        </ButtonGroup>
        <div className="storage-item-list">
            {storageModels.length === 0 && <MessageText>{t.storage.noModels}</MessageText>}
            {storageModels.map((item) => (
                <div className="storage-item-row" key={item.id}>
                    <div className="storage-project-main">
                        <b>{tl(item.label)}</b>
                        <small>
                            {item.provider || t.storage.model}
                            {item.backend ? ` · ${item.backend}` : ""} · {item.relative_path}
                        </small>
                        <div className="storage-project-breakdown">
                            <span>{formatBytes(item.bytes)}</span>
                            <span>{u.filesUnit.replace("{n}", String(item.file_count))}</span>
                        </div>
                    </div>
                    <div className="storage-project-actions">
                        <button type="button" disabled={storageBusy} onClick={() => openModelFolder(item.id)}>
                            {t.common.openFolder}
                        </button>
                        <button
                            className="danger-action"
                            type="button"
                            disabled={storageBusy || item.active}
                            onClick={() =>
                                runStorageCleanupDirect(["delete_model_items"], {
                                    modelIds: [item.id],
                                    confirmation: t.storage.confirmDeleteModel.replace("{label}", tl(item.label)),
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
