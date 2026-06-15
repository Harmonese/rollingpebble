import type { Language } from "../../../languages/index.js";
import type { JobModel } from "../../../shared/api/types.js";
import { MutedText } from "../../../ui/index.js";
import {
    buildStageSequence,
    jobStatusLabel,
    progressMessage,
    progressStageLabel,
    stageStatus,
} from "./rollerProgress.js";

export const JobProgress: React.FC<{
    job: JobModel | null;
    lang: Language;
}> = ({ job, lang }) => {
    const u = lang.ui;
    const progress = job?.progress || null;
    const progressPercent = progress?.progress ?? progress?.percent ?? null;
    const progressWidth = typeof progressPercent === "number" && Number.isFinite(progressPercent)
        ? `${Math.max(0, Math.min(1, progressPercent)) * 100}%`
        : undefined;
    if (!job || !["queued", "running", "succeeded", "failed", "canceled"].includes(job.status)) return null;

    const stageLabels = {
        queued: u.statusQueued,
        running: u.statusRunning,
        preflight: u.modelPreflight,
        modelDownload: u.modelDownload,
        splitter: u.splitter,
        filter: u.filtering,
        transcriber: u.transcription,
        parser: u.lyricsParsing,
        aligner: u.alignment,
        writer: u.writer,
    };
    const stageSequence = buildStageSequence(stageLabels);

    return (
        <section className="studio-progress-card" aria-live="polite">
            <div className="studio-progress-head">
                <b>
                    {progressStageLabel(
                        progress?.stage || (job.status === "queued" ? "queued" : "running"),
                        stageLabels,
                        { preparing: u.preparing, complete: u.complete },
                    )}
                </b>
                <span>
                    {typeof progressPercent === "number"
                        ? `${Math.round(progressPercent * 100)}%`
                        : jobStatusLabel(job.status, u)}
                </span>
            </div>
            <div className={progressWidth ? "studio-progress-bar" : "studio-progress-bar indeterminate"}>
                <span style={progressWidth ? { width: progressWidth } : undefined} />
            </div>
            <div className="studio-progress-meta">
                <span>
                    {progressMessage(progress, {
                        waiting: u.progressWaiting,
                        working: u.progressWorking,
                        segmentsUnit: u.segmentsUnit,
                        backendMessages: lang.backendMessages,
                    })}
                </span>
                {progress && progress.total > 0 && <em>{progress.completed}/{progress.total} {progress.unit}</em>}
            </div>
            {progress?.cache_dir && <MutedText className="progress-cache">Cache: {progress.cache_dir}</MutedText>}
            <ol className="studio-stage-list">
                {stageSequence.map((item) => (
                    <li
                        key={item.key}
                        className={`stage-${
                            stageStatus(
                                item.key,
                                progress?.stage || "",
                                stageSequence,
                                job.status,
                                job.completed_stages || [],
                            )
                        }`}
                    >
                        <span />
                        {item.label}
                    </li>
                ))}
            </ol>
        </section>
    );
};
