import { createContext } from "react";
import type { LyricsTrimOptions } from "../domain/lyrics/types.js";
import type { PreferenceAction, PreferenceState } from "./preferences.js";

export interface AppContextValue {
    lang: Language;
    prefState: PreferenceState;
    prefDispatch: React.Dispatch<PreferenceAction>;
    trimOptions: Required<LyricsTrimOptions>;
}

const enum Bits {
    lang,
    builtInAudio,
    prefState,
}

export const enum AppContextBits {
    lang = 1 << Bits.lang,
    builtInAudio = 1 << Bits.builtInAudio,
    prefState = 1 << Bits.prefState,
}

export const appContext = createContext<AppContextValue>(undefined, (prev, next) => {
    let bits = 0;

    if (prev.lang !== next.lang) {
        bits |= AppContextBits.lang;
    }

    if (prev.prefState.builtInAudio !== next.prefState.builtInAudio) {
        bits |= AppContextBits.builtInAudio;
    }

    if (prev.prefState !== next.prefState) {
        bits |= AppContextBits.prefState;
    }

    return bits;
});
