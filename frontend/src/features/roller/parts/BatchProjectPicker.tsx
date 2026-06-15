import type { ProjectModel } from "../../../shared/api/types.js";
import { ButtonGroup, MutedText, SectionTitle } from "../../../ui/index.js";

export const BatchProjectPicker: React.FC<{
    projects: ProjectModel[];
    selectedIds: Set<string>;
    labels: {
        selectProjects: string;
        noBatchProjects: string;
        selectAll: string;
        deselectAll: string;
        selected: string;
    };
    onToggle: (id: string) => void;
    onSelectAll: () => void;
    onDeselectAll: () => void;
}> = ({ projects, selectedIds, labels, onToggle, onSelectAll, onDeselectAll }) => (
    <>
        <SectionTitle>{labels.selectProjects}</SectionTitle>
        {projects.length === 0 && <MutedText>{labels.noBatchProjects}</MutedText>}
        {projects.length > 0 && (
            <>
                <ButtonGroup compact>
                    <button type="button" onClick={onSelectAll}>{labels.selectAll}</button>
                    <button type="button" onClick={onDeselectAll}>{labels.deselectAll}</button>
                </ButtonGroup>
                <div className="studio-list batch-project-list">
                    {projects.map((project) => (
                        <label key={project.project_id} className="batch-project-option">
                            <input
                                type="checkbox"
                                checked={selectedIds.has(project.project_id)}
                                onChange={() => onToggle(project.project_id)}
                            />
                            <span>
                                <b>{project.audio_name || project.project_id}</b>
                                {project.audio_name && <small>{project.project_id}</small>}
                            </span>
                        </label>
                    ))}
                </div>
                <MutedText>{labels.selected.replace("{n}", String(selectedIds.size))}</MutedText>
            </>
        )}
    </>
);
