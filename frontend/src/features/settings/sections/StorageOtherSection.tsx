import { formatBytes } from "../../../shared/format.js";
import { MessageText } from "../../../ui/index.js";
import type { StorageSettingsProps } from "./storageTypes.js";

export const StorageOtherSection: React.FC<Pick<
    StorageSettingsProps,
    "openOtherFolder" | "runStorageCleanupDirect" | "storageBusy" | "storageOtherItems" | "t" | "tl" | "u"
>> = ({ openOtherFolder, runStorageCleanupDirect, storageBusy, storageOtherItems, t, tl, u }) => (
    <details>
        <summary>{t.storage.other}</summary>
        <div className="storage-item-list">
            {storageOtherItems.length === 0 && <MessageText>{t.storage.noOther}</MessageText>}
            {storageOtherItems.map((item) => (
                <div className="storage-item-row" key={item.relative_path}>
                    <div className="storage-project-main">
                        <b>{tl(item.label)}</b>
                        <small>{item.relative_path}</small>
                        <div className="storage-project-breakdown">
                            <span>{formatBytes(item.bytes)}</span>
                            <span>{u.filesUnit.replace("{n}", String(item.file_count))}</span>
                        </div>
                    </div>
                    <div className="storage-project-actions">
                        <button
                            type="button"
                            disabled={storageBusy}
                            onClick={() => openOtherFolder(item.relative_path)}
                        >
                            {t.common.openFolder}
                        </button>
                        {item.removable && (
                            <button
                                className="danger-action"
                                type="button"
                                disabled={storageBusy}
                                onClick={() =>
                                    runStorageCleanupDirect(["delete_other_items"], {
                                        otherPaths: [item.relative_path],
                                        confirmation: t.storage.confirmDeleteOther.replace(
                                            "{label}",
                                            tl(item.label),
                                        ),
                                    })}
                            >
                                {t.common.delete}
                            </button>
                        )}
                    </div>
                </div>
            ))}
        </div>
    </details>
);
