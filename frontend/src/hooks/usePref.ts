import { useReducer } from "react";
import { defaultPreferences, themeColor, type PreferenceAction, type PreferenceState } from "../shared/preferences.js";

export { themeColor, ThemeMode } from "../shared/preferences.js";
export type { PreferenceAction as Action, PreferenceState as State } from "../shared/preferences.js";

const reducer = (state: PreferenceState, action: PreferenceAction): PreferenceState => {
    const payload = action.payload;
    return {
        ...state,
        [action.type]: typeof payload === "function" ? payload(state) : payload,
    };
};

const langCodeList = i18n.langCodeList;
const isHexColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

function readStoredState(raw: string): Partial<PreferenceState> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed as Partial<PreferenceState> : {};
    } catch {
        return {};
    }
}

const init = (lazyInit: () => string): PreferenceState => {
    const state: Mutable<PreferenceState> = { ...defaultPreferences };

    const languages = navigator.languages || [navigator.language || "en-US"];

    state.lang = languages
        .map((langCode) => {
            if (langCode === "zh") {
                return "zh-CN";
            }
            if (langCode.startsWith("en")) {
                return "en-US";
            }
            return langCode;
        })
        .find((langCode) => langCodeList.includes(langCode)) || "en-US";

    const storedState = readStoredState(lazyInit());
    const validKeys = Object.keys(defaultPreferences) as (keyof PreferenceState)[];
    for (const key of validKeys) {
        if (key in storedState) {
            (state[key] as unknown) = storedState[key];
        }
    }
    if (state.themeColor === themeColor.pink) {
        state.themeColor = themeColor.logic;
    }
    if (!isHexColor(state.themeColor)) {
        state.themeColor = themeColor.logic;
    }
    return state;
};

export const usePref = (lazyInit: () => string): [PreferenceState, React.Dispatch<PreferenceAction>] => useReducer(reducer, lazyInit, init);
