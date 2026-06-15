export const themeColor = {
    logic: "#23d18b",
    orange: "#ff691f",
    yellow: "#fab81e",
    blue: "#91d2fa",
    navy: "#1b95e0",
    red: "#e81c4f",
    pink: "#f58ea8",
    purple: "#c877fe",
};

export const enum ThemeMode {
    auto,
    light,
    dark,
}

export const defaultPreferences = {
    lang: "en-US",
    spaceStart: 1,
    spaceEnd: 0,
    fixed: 3 as Fixed,
    builtInAudio: false,
    showWaveform: true,
    screenButton: false,
    themeColor: themeColor.logic,
    themeMode: ThemeMode.dark,
};

export type PreferenceState = Readonly<typeof defaultPreferences>;

export type PreferenceAction = {
    [key in keyof PreferenceState]: {
        type: key;
        payload: PreferenceState[key] | ((state: PreferenceState) => PreferenceState[key]);
    };
}[keyof PreferenceState];
