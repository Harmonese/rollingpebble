export const SETTINGS_UPDATED_EVENT = "rollingpebble:settings-updated";

export const notifySettingsUpdated = (): void => {
    window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT));
};
