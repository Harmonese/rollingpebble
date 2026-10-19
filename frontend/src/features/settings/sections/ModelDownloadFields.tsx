import { useContext } from "react";
import type { RuntimeSettings } from "../../../shared/api/types.js";
import { appContext } from "../../../shared/appContext.js";
import { CheckRow, FormGrid } from "../../../ui/index.js";

export type ModelNetwork = Pick<
    RuntimeSettings,
    "model_download_source" | "model_proxy_enabled" | "auto_timing_hf_proxy" | "auto_timing_hf_download_timeout"
>;
export const modelNetwork = (value: RuntimeSettings): ModelNetwork => ({
    model_download_source: value.model_download_source || "modelscope",
    model_proxy_enabled: value.model_proxy_enabled ?? Boolean(value.auto_timing_hf_proxy),
    auto_timing_hf_proxy: value.auto_timing_hf_proxy || "",
    auto_timing_hf_download_timeout: Math.min(30, Math.max(1, value.auto_timing_hf_download_timeout || 30)),
});

export function ModelDownloadFields({ value, onChange, disabled = false }: {
    value: ModelNetwork;
    onChange: (value: ModelNetwork) => void;
    disabled?: boolean;
}) {
    const { lang } = useContext(appContext);
    const t = lang.modelSetup;
    return (
        <fieldset disabled={disabled} className="model-download-fields">
            <FormGrid>
                <label>
                    {t.source}
                    <select
                        value={value.model_download_source}
                        onChange={e =>
                            onChange({
                                ...value,
                                model_download_source: e.target.value as ModelNetwork["model_download_source"],
                            })}
                    >
                        <option value="modelscope">{t.domestic}</option>
                        <option value="official">{t.official}</option>
                    </select>
                </label>
            </FormGrid>
            <CheckRow
                title={t.proxy}
                checked={value.model_proxy_enabled}
                onChange={enabled => onChange({ ...value, model_proxy_enabled: enabled })}
            />
            {value.model_proxy_enabled && (
                <FormGrid>
                    <label>
                        {lang.settings.autoTiming.proxyUrl}
                        <input
                            type="url"
                            value={value.auto_timing_hf_proxy}
                            autoComplete="off"
                            onChange={e => onChange({ ...value, auto_timing_hf_proxy: e.target.value })}
                        />
                    </label>
                </FormGrid>
            )}
            <FormGrid>
                <label>
                    {lang.settings.autoTiming.fileDownloadTimeout}
                    <input
                        type="number"
                        min={1}
                        max={30}
                        value={value.auto_timing_hf_download_timeout || 30}
                        onChange={e =>
                            onChange({
                                ...value,
                                auto_timing_hf_download_timeout: Math.max(
                                    1,
                                    Math.min(30, Number(e.target.value) || 1),
                                ),
                            })}
                    />
                </label>
            </FormGrid>
        </fieldset>
    );
}
