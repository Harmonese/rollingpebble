export const PROJECTS_CHANGED_EVENT = "rollingpebble:projects-changed";
export function notifyProjectsChanged(deletedIds: string[] = []): void {
    window.dispatchEvent(new CustomEvent(PROJECTS_CHANGED_EVENT, { detail: deletedIds }));
}
