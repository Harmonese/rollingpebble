import { useContext } from "react";
import { appContext, AppContextBits } from "../../shared/appContext.js";
import { Message, Panel, SectionTitle, Tabs } from "../../ui/index.js";

import { useAutoTimingJob } from "./controllers/useAutoTimingJob.js";
import { useAutoTimingState } from "../../domain/auto-timing/useAutoTimingState.js";
import { useSettingsUpdated } from "../../hooks/useSettingsUpdated.js";
import type { MetaModel, ProjectModel } from "../../shared/api/types.js";
import { settings } from "../../shared/api/settings.js";
import { AutoTimingFields } from "./AutoTimingFields.js";
import { BatchProjectPicker } from "./parts/BatchProjectPicker.js";
import { CommandPreview } from "./parts/CommandPreview.js";
import { InputStatus } from "./parts/InputStatus.js";
import { JobLog } from "./parts/JobLog.js";
import { JobProgress } from "./parts/JobProgress.js";
import { RunActions } from "./parts/RunActions.js";

export const RollerPanel: React.FC<{
    project: ProjectModel | null;
    plainLyrics: string;
    syncedLyrics: string;
    editorMeta: MetaModel;
    onProject: (project: ProjectModel, applyToEditor?: boolean) => void;
    onImportText: (text: string) => void;
}> = ({ project, plainLyrics, syncedLyrics, editorMeta, onProject, onImportText }) => {
    const at = useAutoTimingState();
    const { lang, prefState } = useContext(appContext, AppContextBits.lang | AppContextBits.prefState);
    const u = lang.ui;
    const s = lang.settings;
    const trOpt = (key: string) => (lang.optionLabels as Record<string, string | undefined>)?.[key] || key;

    const loadDefaults = async () => {
        try {
            const runtimeSettings = await settings();
            at.loadFromSettings(runtimeSettings);
        } catch {
            // Settings are optional for initial rendering. Keep built-in defaults.
        }
    };

    useSettingsUpdated(loadDefaults, true);

    const jobState = useAutoTimingJob({
        at,
        project,
        plainLyrics,
        syncedLyrics,
        editorMeta,
        uiLang: prefState.lang,
        lang,
        onProject,
        onImportText,
    });

    const startDisabled = jobState.busy || jobState.running || !jobState.inputState.ready;
    const batchStartDisabled = jobState.busy || jobState.running || jobState.selectedBatchIds.size === 0;

    return (
        <Panel title={u.autoTiming}>

            <Tabs
                ariaLabel={u.autoTiming}
                items={[{ value: "single", label: u.single }, { value: "batch", label: u.batch }]}
                value={jobState.batchMode}
                onChange={jobState.setMode}
            />

            {jobState.batchMode === "batch" && (
                <BatchProjectPicker
                    projects={jobState.batchProjects}
                    selectedIds={jobState.selectedBatchIds}
                    labels={u}
                    onToggle={jobState.toggleBatchProject}
                    onSelectAll={jobState.selectAllBatchProjects}
                    onDeselectAll={jobState.deselectAllBatchProjects}
                />
            )}

            {jobState.batchMode === "single" && (
                <InputStatus
                    at={at}
                    inputState={jobState.inputState}
                    previewError={jobState.previewError}
                    labels={u}
                />
            )}

            <SectionTitle>{u.parameters}</SectionTitle>
            <AutoTimingFields at={at} labels={s.autoTiming} optionLabel={trOpt} showOnlyIncluded disableUnavailable />

            <JobProgress job={jobState.job} lang={lang} />

            <RunActions
                mode={jobState.batchMode}
                labels={u}
                singleStartDisabled={startDisabled}
                batchStartDisabled={batchStartDisabled}
                cancelDisabled={!jobState.running || jobState.busy}
                retrySingleDisabled={jobState.busy || jobState.running || !project}
                retryBatchDisabled={batchStartDisabled}
                onStart={() => void jobState.start()}
                onStartBatch={() => void jobState.startBatch()}
                onCancel={() => void jobState.cancel()}
                onRetry={() => void jobState.retry()}
            />
            <Message
                message={jobState.message}
                type={jobState.messageType}
                fading={jobState.messageFading}
                messageKey={jobState.messageKey}
            />

            {jobState.batchMode === "single" && (
                <CommandPreview
                    preview={jobState.preview}
                    job={jobState.job}
                    previewBusy={jobState.previewBusy}
                    lang={lang}
                    onCopy={() => void jobState.copyCommand()}
                />
            )}

            {jobState.batchMode === "single" && (
                <JobLog
                    job={jobState.job}
                    lang={lang}
                    onCopy={() => void jobState.copyLog()}
                    onOpenFolder={() => void jobState.openJobFolder()}
                />
            )}
        </Panel>
    );
};
