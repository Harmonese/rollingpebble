import { isRunActive, type TimingOptions, type TimingRun } from "../../shared/api/timingV2.js";

export const timingOptionsEqual = (a: TimingOptions, b: TimingOptions) =>
    JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

export function canRetryTiming(run: TimingRun | null, current: {
    projectId?: string;
    workspaceId: string;
    signature: string;
    options: TimingOptions;
}): boolean {
    return Boolean(
        run && !isRunActive(run) && run.kind === "run"
            && current.projectId && run.project_id === current.projectId
            && run.workspace_id && run.workspace_id === current.workspaceId
            && run.lyrics_version && run.lyrics_version === current.signature
            && run.audio_identity && run.lyrics_hash
            && timingOptionsEqual(current.options, run.options || {} as TimingOptions),
    );
}
