export const SETTINGS_UPDATED_EVENT = "lrc-roller:settings-updated";

export const notifySettingsUpdated = (): void => {
    window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT));
};
