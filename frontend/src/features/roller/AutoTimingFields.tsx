import { useContext } from "react";
import type { AutoTimingHook } from "../../domain/auto-timing/useAutoTimingState.js";
import type { TimingLanguage } from "../../shared/api/timingV2.js";
import { appContext } from "../../shared/appContext.js";
import { CheckRow, FormGrid } from "../../ui/index.js";

export const AutoTimingFields: React.FC<
    {
        at: AutoTimingHook;
        settingsMode?: boolean;
        advanced?: React.ReactNode;
        onLanguageChange?: (language: TimingLanguage) => void;
    }
> = (
    { at, settingsMode = false, advanced, onLanguageChange },
) => {
    const { lang } = useContext(appContext);
    const t = lang.timingV2;
    const { options, setOptions } = at;
    const audio = (
        <label>
            {t.audio}
            <select
                value={options.audio_mode}
                onChange={e => setOptions({ ...options, audio_mode: e.target.value as "mix" | "vocals" })}
            >
                <option value="mix">{t.original}</option>
                <option value="vocals">{t.vocals}</option>
            </select>
        </label>
    );
    const mode = (
        <label>
            {t.alignmentMode}
            <select
                value={options.alignment_mode}
                onChange={e => setOptions({ ...options, alignment_mode: e.target.value as "ordered" | "unordered" })}
            >
                <option value="ordered">{t.ordered}</option>
                <option value="unordered">{t.unordered}</option>
            </select>
        </label>
    );
    const defaults = (
        <>
            <FormGrid columns={2}>
                <label>
                    {t.device}
                    <select
                        value={options.ctc_device}
                        onChange={e => setOptions({ ...options, ctc_device: e.target.value as "auto" | "cpu" | "mps" })}
                    >
                        <option value="auto">{t.auto}</option>
                        <option value="cpu">CPU</option>
                        <option value="mps">MPS</option>
                    </select>
                </label>
                <label>
                    {t.threads}
                    <input
                        type="number"
                        min={1}
                        max={256}
                        value={options.cpu_threads}
                        onChange={e =>
                            setOptions({
                                ...options,
                                cpu_threads: Math.max(1, Math.min(256, Number(e.target.value) || 1)),
                            })}
                    />
                </label>
            </FormGrid>
            <CheckRow
                title={t.previews}
                checked={options.previews}
                onChange={previews => setOptions({ ...options, previews })}
            />
        </>
    );
    return (
        <>
            <FormGrid columns={settingsMode ? 2 : 1}>
                {audio}
                {mode}
                <label title={t.languageHint}>
                    {t.language}
                    <select
                        value={options.language}
                        onChange={e => {
                            const language = e.target.value as TimingLanguage;
                            setOptions({ ...options, language });
                            onLanguageChange?.(language);
                        }}
                    >
                        {Object.entries(lang.autoTimingLanguages).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                        ))}
                    </select>
                </label>
            </FormGrid>
            {settingsMode && defaults}
            <details>
                <summary>{t.advanced}</summary>
                {!settingsMode && defaults}
                <FormGrid>
                    <label>
                        {t.whisperPath}
                        <input
                            value={options.whisper_model || ""}
                            onChange={e => setOptions({ ...options, whisper_model: e.target.value || null })}
                        />
                    </label>
                    <label>
                        {t.ctcEnglish}
                        <input
                            value={options.ctc_model || ""}
                            onChange={e => setOptions({ ...options, ctc_model: e.target.value || null })}
                        />
                    </label>
                    <label>
                        {t.ctcMandarin}
                        <input
                            value={options.ctc_zh_model || ""}
                            onChange={e => setOptions({ ...options, ctc_zh_model: e.target.value || null })}
                        />
                    </label>
                    <label>
                        {t.ctcMultilingual}
                        <input
                            value={options.ctc_mul_model || ""}
                            onChange={e => setOptions({ ...options, ctc_mul_model: e.target.value || null })}
                        />
                    </label>
                </FormGrid>
                {advanced}
            </details>
        </>
    );
};
