import { useCallback, useState } from "react";
import { defaultTimingOptions, type TimingOptions } from "../../shared/api/timingV2.js";

export function useAutoTimingState() {
    const [options, setOptions] = useState<TimingOptions>(defaultTimingOptions);
    const loadFromSettings = useCallback((settings: { auto_timing_v2_options?: Partial<TimingOptions> }) => {
        setOptions({ ...defaultTimingOptions, ...settings.auto_timing_v2_options });
    }, []);
    const buildSettingsPayload = useCallback(() => ({ auto_timing_v2_options: options }), [options]);
    return { options, setOptions, loadFromSettings, buildSettingsPayload };
}
export type AutoTimingHook = ReturnType<typeof useAutoTimingState>;
