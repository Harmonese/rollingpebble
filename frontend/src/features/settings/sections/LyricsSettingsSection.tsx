import type React from "react";
import type { PreferenceAction as PrefAction, PreferenceState as PrefState } from "../../../shared/preferences.js";
import type { Language } from "../../../languages/index.js";
import { CheckRow, FormGrid, SectionTitle } from "../../../ui/index.js";
import { SpaceStepper } from "./SpaceStepper.js";

export const LyricsSettingsSection: React.FC<{
    title: string;
    t: Language["settings"];
    prefState: PrefState;
    prefDispatch: React.Dispatch<PrefAction>;
    busy: boolean;
    recentProjectsLimit: string;
    setRecentProjectsLimit: (value: string) => void;
    saveRecentProjectsLimit: () => void;
    audioRegexEnabled: boolean;
    audioRegex: string;
    setAudioRegex: (value: string) => void;
    setAudioRegexEnabled: (value: boolean) => void;
    saveAudioRegexEnabled: (value: boolean) => void;
    saveAudioRegex: () => void;
    autoFillLibrary: boolean;
    saveAutoFillLibrary: (value: boolean) => void;
    editorWriteMetadataTags: boolean;
    saveEditorWriteMetadataTags: (value: boolean) => void;
}> = ({
    title,
    t,
    prefState,
    prefDispatch,
    busy,
    recentProjectsLimit,
    setRecentProjectsLimit,
    saveRecentProjectsLimit,
    audioRegexEnabled,
    audioRegex,
    setAudioRegex,
    setAudioRegexEnabled,
    saveAudioRegexEnabled,
    saveAudioRegex,
    autoFillLibrary,
    saveAutoFillLibrary,
    editorWriteMetadataTags,
    saveEditorWriteMetadataTags,
}) => (
    <section className="settings-section">
        <h3>{title}</h3>
        <div className="settings-subsection">
            <SectionTitle>{t.project.title}</SectionTitle>
            <FormGrid columns={2}>
                <label>
                    {t.project.projectListShown}
                    <input
                        inputMode="numeric"
                        value={recentProjectsLimit}
                        onChange={(ev) => setRecentProjectsLimit(ev.target.value)}
                        onBlur={saveRecentProjectsLimit}
                    />
                </label>
            </FormGrid>
        </div>

        <div className="settings-subsection">
            <SectionTitle>{t.importAudio.title}</SectionTitle>
            <CheckRow
                checked={audioRegexEnabled}
                disabled={busy}
                title={t.importAudio.extractMetadata}
                description={t.importAudio.extractMetadataDesc}
                onChange={(checked) => {
                    setAudioRegexEnabled(checked);
                    saveAudioRegexEnabled(checked);
                }}
            />
            <FormGrid className="settings-form-spaced">
                <label>
                    {t.importAudio.regexPattern}
                    <input
                        placeholder="(?P&lt;artist&gt;.+?) - (?P&lt;track&gt;.+?)"
                        value={audioRegex}
                        onChange={(ev) => setAudioRegex(ev.target.value)}
                        onBlur={saveAudioRegex}
                        disabled={!audioRegexEnabled}
                    />
                </label>
            </FormGrid>
        </div>

        <div className="settings-subsection">
            <SectionTitle>{t.importLyrics.title}</SectionTitle>
            <CheckRow
                checked={autoFillLibrary}
                disabled={busy}
                title={t.importLyrics.autoFill}
                description={t.importLyrics.autoFillDesc}
                onChange={saveAutoFillLibrary}
            />
        </div>

        <div className="settings-subsection">
            <SectionTitle>{t.syncEditor.title}</SectionTitle>
            <CheckRow
                checked={editorWriteMetadataTags}
                disabled={busy}
                title={t.syncEditor.writeMetadata}
                description={t.syncEditor.writeMetadataDesc}
                onChange={saveEditorWriteMetadataTags}
            />
            <CheckRow
                checked={prefState.screenButton}
                title={t.syncEditor.screenButton}
                description={t.syncEditor.screenButtonDesc}
                onChange={() => prefDispatch({ type: "screenButton", payload: (s) => !s.screenButton })}
            />
            <FormGrid columns={2} className="settings-form-spaced">
                <label>
                    {t.syncEditor.timestampDecimals}
                    <select
                        value={prefState.fixed}
                        onChange={(ev) => prefDispatch({ type: "fixed", payload: Number(ev.target.value) as Fixed })}
                    >
                        <option value={0}>0</option>
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                    </select>
                </label>
                <SpaceStepper
                    label={t.syncEditor.leftSpace}
                    value={prefState.spaceStart}
                    onChange={(value) => prefDispatch({ type: "spaceStart", payload: value })}
                />
                <SpaceStepper
                    label={t.syncEditor.rightSpace}
                    value={prefState.spaceEnd}
                    onChange={(value) => prefDispatch({ type: "spaceEnd", payload: value })}
                />
            </FormGrid>
        </div>
    </section>
);
