import type { Language } from "../../../languages/index.js";
import type { TimingRun } from "../../../shared/api/timingV2.js";
import { Button, IconButton } from "../../../ui/Button.js";
import { StatusPill } from "../../../ui/StatusPill.js";

export const TimingResultRow: React.FC<{
    run: TimingRun;
    title: string;
    lang: Language;
    busy: boolean;
    deleteDisabled?: boolean;
    onOpen: () => void;
    onDelete?: () => void;
}> = ({ run, title, lang, busy, deleteDisabled, onOpen, onDelete }) => {
    const date = new Date(run.created_at);
    return (
        <div className="timing-result-row">
            <div className="timing-result-main">
                <b title={title}>{title}</b>
                <time dateTime={run.created_at} title={date.toLocaleString()}>
                    {date.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                </time>
                <StatusPill>{lang.timingV2[run.status]}</StatusPill>
                <span className="ui-muted">
                    {run.options?.alignment_mode === "ordered" ? lang.timingV2.ordered : lang.timingV2.unordered}
                </span>
            </div>
            <div className="timing-result-actions">
                <Button disabled={busy} onClick={onOpen}>{lang.timingV2.open}</Button>
                {onDelete && (
                    <IconButton
                        tone="danger"
                        title={run.kind === "batch" ? lang.timingV2.deleteBatch : lang.timingV2.deleteResult}
                        aria-label={run.kind === "batch" ? lang.timingV2.deleteBatch : lang.timingV2.deleteResult}
                        disabled={deleteDisabled}
                        onClick={onDelete}
                    >
                        ×
                    </IconButton>
                )}
            </div>
        </div>
    );
};
