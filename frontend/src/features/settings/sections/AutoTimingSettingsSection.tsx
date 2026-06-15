import type { AutoTimingHook } from "../../../domain/auto-timing/useAutoTimingState.js";
import type { Language } from "../../../languages/index.js";
import type { AutoRollerRuntime, JobModel } from "../../../shared/api/types.js";
import { ActionRow, FormGrid, MessageText, SectionTitle } from "../../../ui/index.js";
import { AutoTimingFields } from "../../roller/AutoTimingFields.js";
import { RuntimeJobTerminal } from "./RuntimeJobTerminal.js";
import type { Profile } from "./types.js";

export const AutoTimingSettingsSection: React.FC<{
    title: string;
    lang: Language;
    t: Language["settings"];
    u: Language["ui"];
    profile: Profile;
    busy: boolean;
    runtimeJobRunning: boolean;
    runtime: AutoRollerRuntime | null;
    saveProfile: (value: Profile) => void;
    runDoctor: () => void;
    runInstall: () => void;
    runUpgrade: () => void;
    runCacheModel: () => void;
    copyDiagnostics: () => void;
    refresh: (notify?: boolean) => void;
    cancelRuntimeJob: () => void;
    runtimeError: string;
    job: JobModel | null;
    runtimeJobElapsed: number | null;
    runtimeJobLastOutput: number | null;
    at: AutoTimingHook;
    trOpt: (key: string) => string;
}> = ({
    title,
    lang,
    t,
    u,
    profile,
    busy,
    runtimeJobRunning,
    runtime,
    saveProfile,
    runDoctor,
    runInstall,
    runUpgrade,
    runCacheModel,
    copyDiagnostics,
    refresh,
    cancelRuntimeJob,
    runtimeError,
    job,
    runtimeJobElapsed,
    runtimeJobLastOutput,
    at,
    trOpt,
}) => (
    <section className="settings-section">
        <h3>{title}</h3>
        <div className="settings-subsection">
            <SectionTitle>{t.autoTiming.runtime}</SectionTitle>
            <FormGrid className="settings-profile-row">
                <label>
                    {t.autoTiming.runtimeProfile}
                    <select
                        value={profile}
                        disabled={busy || runtimeJobRunning}
                        onChange={(ev) => saveProfile(ev.target.value as Profile)}
                    >
                        <option value="auto">{t.general.themeModeAuto}</option>
                        <option value="cpu">{u.cpuOnly}</option>
                        <option value="cu124">{u.cuda124}</option>
                    </select>
                </label>
            </FormGrid>
            <ActionRow title={t.autoTiming.runtimeCheck} description={t.autoTiming.runtimeCheckDesc}>
                <button
                    type="button"
                    disabled={busy || runtimeJobRunning}
                    title={busy ? t.runtime.busy : runtimeJobRunning ? t.runtime.jobRunning : ""}
                    onClick={runDoctor}
                >
                    {t.autoTiming.checkAction}
                </button>
            </ActionRow>
            <ActionRow title={t.autoTiming.runtimeEnvironment} description={t.autoTiming.runtimeEnvironmentDesc}>
                <button
                    type="button"
                    disabled={busy || runtimeJobRunning}
                    title={busy ? t.runtime.busy : runtimeJobRunning ? t.runtime.jobRunning : ""}
                    onClick={runInstall}
                >
                    {t.autoTiming.createRuntime}
                </button>
            </ActionRow>
            <ActionRow title={t.autoTiming.pyrollerPackage} description={t.autoTiming.pyrollerPackageDesc}>
                <button
                    type="button"
                    disabled={busy || runtimeJobRunning || runtime?.runtime_status !== "ready"}
                    title={busy
                        ? t.runtime.busy
                        : runtimeJobRunning
                        ? t.runtime.jobRunning
                        : runtime?.runtime_status !== "ready"
                        ? t.runtime.notReady
                        : ""}
                    onClick={runUpgrade}
                >
                    {t.autoTiming.upgradeAction}
                </button>
            </ActionRow>
            <ActionRow title={t.autoTiming.modelCache} description={t.autoTiming.modelCacheDesc}>
                <button
                    type="button"
                    disabled={busy || runtimeJobRunning || runtime?.runtime_status !== "ready"}
                    title={busy
                        ? t.runtime.busy
                        : runtimeJobRunning
                        ? t.runtime.jobRunning
                        : runtime?.runtime_status !== "ready"
                        ? t.runtime.notReady
                        : ""}
                    onClick={runCacheModel}
                >
                    {t.autoTiming.preDownload}
                </button>
            </ActionRow>
            <ActionRow title={t.autoTiming.diagnostics} description={t.autoTiming.diagnosticsDesc}>
                <button type="button" onClick={copyDiagnostics}>{t.autoTiming.copyAction}</button>
                <button type="button" onClick={() => refresh(true)}>{t.autoTiming.refreshAction}</button>
            </ActionRow>
            {runtimeJobRunning && (
                <ActionRow title={t.autoTiming.currentJob} description={t.autoTiming.currentJobDesc}>
                    <button
                        type="button"
                        disabled={busy}
                        title={busy ? t.runtime.busy : ""}
                        onClick={cancelRuntimeJob}
                    >
                        {t.common.cancel}
                    </button>
                </ActionRow>
            )}
            {runtimeError && <MessageText type="error" className="runtime-local-notice">{runtimeError}</MessageText>}
            {job && (
                <RuntimeJobTerminal
                    job={job}
                    elapsed={runtimeJobElapsed}
                    lastOutput={runtimeJobLastOutput}
                    tr={t.runtime}
                    jobLabels={t.runtime}
                    jobMsg={{
                        taskComplete: t.runtime.taskComplete,
                        runtimeReady: t.runtime.runtimeReady,
                        upgradedTo: t.runtime.upgradedTo,
                        upgraded: t.runtime.upgraded,
                        cacheModelDone: t.runtime.cacheModelDone,
                    }}
                    backendMessages={lang.backendMessages}
                />
            )}
        </div>

        <div className="settings-subsection">
            <SectionTitle>{t.autoTiming.parameters}</SectionTitle>
            <AutoTimingFields at={at} labels={t.autoTiming} optionLabel={trOpt} />
        </div>
    </section>
);
