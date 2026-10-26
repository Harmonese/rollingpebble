import type { Language } from "../../../languages/index.js";
import { isRunActive, type TimingRun } from "../../../shared/api/timingV2.js";
import { TaskStatus } from "../../../ui/TaskStatus.js";

export const TimingStartupProgress: React.FC<{
    stage: string;
    startedAt: number;
    clock: number;
    elapsedLabel: string;
    failed?: boolean;
    error?: string;
    children?: React.ReactNode;
}> = ({ stage, startedAt, clock, elapsedLabel, failed, error, children }) => (
    <TaskStatus
        title={stage}
        active={!failed}
        error={error}
        meta={<em>{elapsedLabel} · {Math.max(0, Math.floor((clock - startedAt) / 1000))}s</em>}
    >
        {children}
    </TaskStatus>
);

export const TimingProgress: React.FC<{ run: TimingRun; lang: Language; clock: number }> = ({ run, lang, clock }) => {
    const t = lang.timingV2;
    const active = isRunActive(run);
    const progress = run.progress;
    const stage = active && progress ? t[progress.stage as keyof typeof t] || progress.stage : t[run.status];
    const processed = progress?.audio_available_until;
    const duration = progress?.duration;
    const fraction = processed !== undefined && duration !== undefined && duration > 0
        ? Math.max(0, Math.min(1, processed / duration))
        : undefined;
    const elapsed = Math.max(
        0,
        Math.floor(((active ? clock : Date.parse(run.updated_at)) - Date.parse(run.created_at)) / 1000),
    );
    return (
        <TaskStatus
            title={stage}
            active={active}
            fraction={fraction}
            summary={
                <>
                    {run.language && <span title={t.languageHint}>{lang.autoTimingLanguages[run.language]}</span>}
                    {active && progress && <span>{t[run.status]}</span>}
                </>
            }
            meta={
                <>
                    <span>
                        {processed !== undefined
                            ? `${Math.round(processed)}${duration ? ` / ${Math.round(duration)}` : ""}s`
                            : ""}
                    </span>
                    <em>{lang.settings.runtime.elapsed} · {elapsed}s</em>
                </>
            }
        />
    );
};
