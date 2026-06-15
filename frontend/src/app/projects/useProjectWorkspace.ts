import { useCallback, useState } from "react";
import type { ProjectModel } from "../../shared/api/types.js";

export function useProjectWorkspace() {
    const [project, setProject] = useState<ProjectModel | null>(null);

    const setActiveProject = useCallback((next: ProjectModel | null) => {
        setProject(next);
    }, []);

    return { project, setProject: setActiveProject };
}
