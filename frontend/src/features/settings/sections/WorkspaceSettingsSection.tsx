import type React from "react";
import { themeColor as themeColors, ThemeMode, type PreferenceAction as PrefAction, type PreferenceState as PrefState } from "../../../shared/preferences.js";
import type { Language } from "../../../languages/index.js";
import { ActionRow, CheckRow, FormGrid } from "../../../ui/index.js";
import { ColorPicker } from "../ColorPicker.js";

export const WorkspaceSettingsSection: React.FC<{
    title: string;
    t: Language["settings"];
    prefState: PrefState;
    prefDispatch: React.Dispatch<PrefAction>;
    hexInput: string;
    setHexInput: (value: string) => void;
    busy: boolean;
    bgInputRef: React.RefObject<HTMLInputElement>;
    onBgUpload: (ev: React.ChangeEvent<HTMLInputElement>) => void;
    resetBg: () => void;
    resetDisplayPrefs: () => void;
}> = ({ title, t, prefState, prefDispatch, hexInput, setHexInput, busy, bgInputRef, onBgUpload, resetBg, resetDisplayPrefs }) => (
    <section className="settings-section">
        <h3>{title}</h3>
        <FormGrid columns={2}>
            <label>
                {t.general.language}
                <select
                    value={prefState.lang}
                    onChange={(ev) => prefDispatch({ type: "lang", payload: ev.target.value })}
                >
                    {i18n.langMap.map(([code, name]: [string, string]) => (
                        <option key={code} value={code}>{name}</option>
                    ))}
                </select>
            </label>
            <label>
                {t.general.themeMode}
                <select
                    value={prefState.themeMode}
                    onChange={(ev) => prefDispatch({ type: "themeMode", payload: Number(ev.target.value) as ThemeMode })}
                >
                    <option value={ThemeMode.auto}>{t.general.themeModeAuto}</option>
                    <option value={ThemeMode.light}>{t.general.themeModeLight}</option>
                    <option value={ThemeMode.dark}>{t.general.themeModeDark}</option>
                </select>
            </label>
            <div className="settings-form-field two-col-span">
                <span className="settings-field-label">{t.general.themeColor}</span>
                <div className="theme-color-row">
                    {Object.entries(themeColors).map(([name, color]) => (
                        <button
                            key={name}
                            type="button"
                            className={`theme-color-chip${prefState.themeColor === color ? " active" : ""}`}
                            style={{ backgroundColor: color }}
                            title={name}
                            onClick={() => prefDispatch({ type: "themeColor", payload: color })}
                        />
                    ))}
                    <ColorPicker
                        value={prefState.themeColor}
                        title={t.general.themeColor}
                        onChange={(c) => prefDispatch({ type: "themeColor", payload: c })}
                    />
                    <input
                        type="text"
                        className="theme-hex-input"
                        value={hexInput}
                        onChange={(ev) => {
                            const v = ev.target.value;
                            setHexInput(v);
                            if (/^#[0-9a-fA-F]{6}$/.test(v)) prefDispatch({ type: "themeColor", payload: v });
                        }}
                        onBlur={() => {
                            if (!/^#[0-9a-fA-F]{6}$/.test(hexInput)) setHexInput(prefState.themeColor);
                        }}
                        placeholder="#23d18b"
                        maxLength={7}
                    />
                </div>
            </div>
        </FormGrid>
        <CheckRow
            checked={prefState.builtInAudio}
            title={t.general.builtInAudio}
            description={t.general.builtInAudioDesc}
            onChange={() => prefDispatch({ type: "builtInAudio", payload: (s) => !s.builtInAudio })}
        />
        <CheckRow
            checked={prefState.showWaveform}
            title={t.general.showWaveform}
            description={t.general.showWaveformDesc}
            onChange={() => prefDispatch({ type: "showWaveform", payload: (s) => !s.showWaveform })}
        />
        <ActionRow title={t.syncEditor.workspaceBg} description={t.syncEditor.workspaceBgDesc}>
            <input ref={bgInputRef} type="file" accept="image/*" hidden onChange={onBgUpload} />
            <button type="button" onClick={() => bgInputRef.current?.click()}>{t.common.upload}</button>
            <button type="button" onClick={resetBg}>{t.common.reset}</button>
        </ActionRow>
        <ActionRow title={t.general.resetDisplayPrefs}>
            <button type="button" disabled={busy} onClick={resetDisplayPrefs}>{t.common.reset}</button>
        </ActionRow>
    </section>
);
