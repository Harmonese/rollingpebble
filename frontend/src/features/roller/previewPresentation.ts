import { isRunActive, type TimingRun } from "../../shared/api/timingV2.js";

export function showPreviewEditor(run: TimingRun, loaded: boolean, edited: boolean): boolean {
    return loaded
        && (edited
            || Boolean(
                run.snapshot
                    && (!isRunActive(run) || run.snapshot.lines.length > 0
                        || Boolean(run.snapshot.unaligned_lines?.length)),
            ));
}
