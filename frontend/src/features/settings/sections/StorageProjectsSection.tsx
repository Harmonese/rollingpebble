import { formatBytes } from "../../../shared/format.js";
import { ButtonGroup, FormGrid, MessageText } from "../../../ui/index.js";
import type { StorageSettingsProps } from "./storageTypes.js";

export const StorageProjectsSection: React.FC<Pick<
    StorageSettingsProps,
    | "allIntermediateProjectIds"
    | "allStorageProjectIds"
    | "projectAutoDeleteDays"
    | "runStorageCleanupDirect"
    | "saveProjectAutoDeleteDays"
    | "setProjectAutoDeleteDays"
    | "setStorageOlderThanDays"
    | "storageBusy"
    | "storageOlderThanDays"
    | "storageProjects"
    | "t"
    | "tl"
    | "u"
>> = ({
    allIntermediateProjectIds,
    allStorageProjectIds,
    projectAutoDeleteDays,
    runStorageCleanupDirect,
    saveProjectAutoDeleteDays,
    setProjectAutoDeleteDays,
    setStorageOlderThanDays,
    storageBusy,
    storageOlderThanDays,
    storageProjects,
    t,
    tl,
    u,
}) => (
    <details open>
        <summary>{t.storage.projects}</summary>
        <div className="storage-project-toolbar">
            <FormGrid columns={2} className="storage-project-controls">
                <label>
                    {t.storage.olderThan}
                    <select
                        value={storageOlderThanDays}
                        onChange={(ev) => setStorageOlderThanDays(ev.target.value)}
                    >
                        <option value="0">{t.storage.all}</option>
                        <option value="1">{t.storage.oneDay}</option>
                        <option value="7">{t.storage.sevenDays}</option>
                        <option value="30">{t.storage.thirtyDays}</option>
                    </select>
                </label>
                <label>
                    {t.storage.autoDeleteAfterDays}
                    <input
                        inputMode="numeric"
                        min={0}
                        value={projectAutoDeleteDays}
                        onChange={(ev) => setProjectAutoDeleteDays(ev.target.value)}
                        onBlur={saveProjectAutoDeleteDays}
                    />
                </label>
            </FormGrid>
            <ButtonGroup className="storage-actions">
                <button
                    type="button"
                    disabled={storageBusy || allIntermediateProjectIds.length === 0}
                    onClick={() =>
                        runStorageCleanupDirect(["clear_intermediate"], { projectIds: allIntermediateProjectIds })}
                >
                    {t.storage.clearIntermediates}
                </button>
                <button
                    className="danger-action"
                    type="button"
                    disabled={storageBusy || allStorageProjectIds.length === 0}
                    onClick={() =>
                        runStorageCleanupDirect(["delete_projects"], {
                            projectIds: allStorageProjectIds,
                            confirmation: t.storage.confirmDeleteProjects.replace(
                                "{count}",
                                String(allStorageProjectIds.length),
                            ),
                        })}
                >
                    {t.common.delete}
                </button>
            </ButtonGroup>
        </div>
        <div className="storage-project-list">
            {storageProjects.length === 0 && <MessageText>{t.storage.noProjects}</MessageText>}
            {storageProjects.map((project) => (
                <div className={`storage-project-row ${project.active ? "blocked" : ""}`} key={project.project_id}>
                    <div className="storage-project-main">
                        <b>{project.title || project.project_id}</b>
                        <small>
                            {project.artist || u.unknownArtist} · {project.project_id}
                            {project.active ? ` · ${t.runtime.running}` : ""}
                        </small>
                        <div className="storage-project-breakdown">
                            <span>{tl("Total")} {formatBytes(project.total_bytes)}</span>
                            <span>{tl("Intermediate")} {formatBytes(project.intermediate_bytes)}</span>
                        </div>
                    </div>
                    <div className="storage-project-actions">
                        <button
                            type="button"
                            disabled={storageBusy || project.active || !project.has_intermediate}
                            onClick={() =>
                                runStorageCleanupDirect(["clear_intermediate"], {
                                    projectIds: [project.project_id],
                                })}
                        >
                            {t.storage.clearIntermediates}
                        </button>
                        <button
                            className="danger-action"
                            type="button"
                            disabled={storageBusy || project.active}
                            onClick={() =>
                                runStorageCleanupDirect(["delete_projects"], {
                                    projectIds: [project.project_id],
                                    confirmation: t.storage.confirmDeleteProject,
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
