import type { Language } from "../../../languages/index.js";
import { backendMessageText } from "../../../shared/api/request.js";
import type { JobModel } from "../../../shared/api/types.js";
import { ButtonGroup, LogBlock, WarningText } from "../../../ui/index.js";
import { jobStatusLabel } from "./rollerProgress.js";

export const JobLog: React.FC<{
    job: JobModel | null;
    lang: Language;
    onCopy: () => void;
    onOpenFolder: () => void;
}> = ({ job, lang, onCopy, onOpenFolder }) => {
    if (!job) return null;
    const u = lang.ui;
    const logsOpen = ["running", "failed", "succeeded", "canceled"].includes(job.status);
    return (
        <details open={logsOpen}>
            <summary>{u.jobSummary.replace("{status}", jobStatusLabel(job.status, u))} · {job.job_id}</summary>
            <ButtonGroup compact>
                <button type="button" disabled={!job} onClick={onCopy}>{u.copyLog}</button>
                <button type="button" disabled={!job.project_id} onClick={onOpenFolder}>
                    {u.openJobFolder}
                </button>
            </ButtonGroup>
            {(job.error_message || job.error) && (
                <WarningText>
                    {job.error_message ? backendMessageText(job.error_message, lang.backendMessages) : job.error}
                </WarningText>
            )}
            <LogBlock>{job.logs.join("\n") || job.command.join(" ")}</LogBlock>
        </details>
    );
};
