import type { Language } from "../../../languages/index.js";
import { isRunActive, type TimingRun } from "../../../shared/api/timingV2.js";

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
        <section className="studio-progress-card">
            <div className="studio-progress-head" role="status">
                <b>{stage}</b>
                {run.language && <span title={t.languageHint}>{lang.autoTimingLanguages[run.language]}</span>}
                {active && progress && <span>{t[run.status]}</span>}
            </div>
            {active && (
                <div
                    className={`studio-progress-bar${fraction === undefined ? " indeterminate" : ""}`}
                    role="progressbar"
                    aria-label={stage}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={fraction === undefined ? undefined : Math.round(fraction * 100)}
                >
                    <span style={fraction === undefined ? undefined : { width: `${fraction * 100}%` }} />
                </div>
            )}
            <div className="studio-progress-meta">
                <span>
                    {processed !== undefined
                        ? `${Math.round(processed)}${duration ? ` / ${Math.round(duration)}` : ""}s`
                        : ""}
                </span>
                <em>{lang.settings.runtime.elapsed} · {elapsed}s</em>
            </div>
        </section>
    );
};
