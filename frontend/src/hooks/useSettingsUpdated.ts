import { useEffect, useRef } from "react";
import { SETTINGS_UPDATED_EVENT } from "../shared/settingsEvents.js";

export function useSettingsUpdated(callback: () => void | Promise<void>, runNow = false): void {
    const callbackRef = useRef(callback);

    useEffect(() => {
        callbackRef.current = callback;
    }, [callback]);

    useEffect(() => {
        if (runNow) void callbackRef.current();
        const listener = () => void callbackRef.current();
        window.addEventListener(SETTINGS_UPDATED_EVENT, listener);
        return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, listener);
    }, [runNow]);
}
