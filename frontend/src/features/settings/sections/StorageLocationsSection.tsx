import { formatBytes } from "../../../shared/format.js";
import { SectionTitle } from "../../../ui/index.js";
import type { StorageSettingsProps } from "./storageTypes.js";

export const StorageLocationsSection: React.FC<Pick<
    StorageSettingsProps,
    | "browseStorageRoot"
    | "migrateStorageRoot"
    | "openStorageFolder"
    | "runStorageCleanupDirect"
    | "runtime"
    | "safeCleanupAvailable"
    | "setStorageTargetPaths"
    | "storageBusy"
    | "storageTargetPaths"
    | "storageUsage"
    | "t"
    | "tl"
    | "trOpt"
    | "u"
>> = ({
    browseStorageRoot,
    migrateStorageRoot,
    openStorageFolder,
    runStorageCleanupDirect,
    runtime,
    safeCleanupAvailable,
    setStorageTargetPaths,
    storageBusy,
    storageTargetPaths,
    storageUsage,
    t,
    tl,
    trOpt,
    u,
}) => (
    <div className="settings-subsection">
        <SectionTitle>{t.storage.locations}</SectionTitle>
        <div className="ui-action-row storage-location-summary">
            <div className="ui-action-main storage-location-total">
                <b>{t.storage.totalData}</b>
                <small>{storageUsage?.data_dir || runtime?.data_dir || trOpt("loading")}</small>
                <div className="storage-location-meta">
                    <span>{formatBytes(storageUsage?.total_bytes)}</span>
                </div>
            </div>
            <div className="ui-action-buttons">
                <button type="button" disabled={storageBusy} onClick={openStorageFolder}>
                    {t.common.openFolder}
                </button>
                <button
                    type="button"
                    disabled={storageBusy || !safeCleanupAvailable}
                    onClick={() => runStorageCleanupDirect(["safe"])}
                >
                    {t.storage.safeCleanup}
                </button>
            </div>
        </div>
        <div className="storage-location-list">
            {(storageUsage?.roots || []).map((root) => {
                const targetPath = storageTargetPaths[root.id] ?? root.path;
                const changed = targetPath.trim() !== root.path;
                return (
                    <div
                        className={`storage-location-row ${root.movable ? "movable" : "fixed"} ${
                            root.active ? "active" : ""
                        }`}
                        key={root.id}
                    >
                        <div className="storage-location-copy">
                            <b>{tl(root.label)}</b>
                            <small title={root.path}>{root.path}</small>
                            <div className="storage-location-meta">
                                <span>{formatBytes(root.bytes)}</span>
                                <span>{u.filesUnit.replace("{n}", String(root.file_count))}</span>
                                {root.active && <span className="storage-location-pill">{t.storage.active}</span>}
                                {root.path !== root.default_path && (
                                    <span className="storage-location-pill">{t.storage.customLocation}</span>
                                )}
                            </div>
                        </div>
                        <div className="storage-location-control">
                            {root.movable
                                ? (
                                    <label>
                                        <span>{t.storage.targetLocation}</span>
                                        <span className="storage-location-input">
                                            <input
                                                value={targetPath}
                                                disabled={storageBusy}
                                                onChange={(ev) =>
                                                    setStorageTargetPaths((current) => ({
                                                        ...current,
                                                        [root.id]: ev.target.value,
                                                    }))}
                                            />
                                            <button
                                                type="button"
                                                disabled={storageBusy}
                                                onClick={() => browseStorageRoot(root)}
                                            >
                                                {t.common.browse}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={storageBusy || !changed}
                                                onClick={() => migrateStorageRoot(root)}
                                            >
                                                {t.storage.moveHere}
                                            </button>
                                        </span>
                                    </label>
                                )
                                : (
                                    <div className="storage-location-static">
                                        <span>{t.storage.fixedLocation}</span>
                                    </div>
                                )}
                        </div>
                    </div>
                );
            })}
        </div>
    </div>
);
