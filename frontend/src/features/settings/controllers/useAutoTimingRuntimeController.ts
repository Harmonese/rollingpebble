import { useEffect, useRef } from "react";
import type { AutoTimingHook } from "../../../domain/auto-timing/useAutoTimingState.js";
import type { Language } from "../../../languages/index.js";
import { backendMessageText } from "../../../shared/api/request.js";
import { updateSettings } from "../../../shared/api/settings.js";
import { notifySettingsUpdated } from "../../../shared/settingsEvents.js";
import type { SettingsMessageSetter } from "./settingsControllerUtils.js";

export function useAutoTimingRuntimeController(options: {
    open: boolean;
    lang: Language;
    setMessage: SettingsMessageSetter;
    at: AutoTimingHook;
    autoTimingLoaded: boolean;
    settingsLoadKey: number;
}) {
    const { open, lang, setMessage, at, autoTimingLoaded, settingsLoadKey } = options;
    const skip = useRef(true);
    useEffect(() => {
        skip.current = true;
    }, [settingsLoadKey]);
    useEffect(() => {
        if (!open || !autoTimingLoaded) return;
        if (skip.current) {
            skip.current = false;
            return;
        }
        const timer = window.setTimeout(() => {
            void updateSettings(at.buildSettingsPayload()).then(notifySettingsUpdated)
                .catch(error => setMessage(backendMessageText(error, lang.backendMessages), "error"));
        }, 650);
        return () => window.clearTimeout(timer);
    }, [open, autoTimingLoaded, at.buildSettingsPayload, lang.backendMessages, setMessage]);
}
