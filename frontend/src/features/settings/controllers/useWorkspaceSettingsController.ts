import type React from "react";
import { useEffect, useRef, useState } from "react";
import { themeColor as themeColors, ThemeMode, type PreferenceAction as PrefAction, type PreferenceState as PrefState } from "../../../shared/preferences.js";
import type { Language } from "../../../languages/index.js";
import { backendMessageText } from "../../../shared/api/request.js";
import { deleteWorkspaceBg, uploadWorkspaceBg } from "../../../shared/api/settings.js";
import { toastPubSub } from "../../../ui/Toast.js";
import type { SettingsMessageSetter } from "./settingsControllerUtils.js";

export function useWorkspaceSettingsController(options: {
    lang: Language;
    prefState: PrefState;
    prefDispatch: React.Dispatch<PrefAction>;
    setBusy: (busy: boolean) => void;
    setMessage: SettingsMessageSetter;
}) {
    const { lang, prefDispatch, prefState, setBusy, setMessage } = options;
    const bgInputRef = useRef<HTMLInputElement>(null);
    const [hexInput, setHexInput] = useState("");
    const t = lang.settings;
    const u = lang.ui;

    useEffect(() => {
        setHexInput(prefState.themeColor);
    }, [prefState.themeColor]);

    const onBgUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try {
            await uploadWorkspaceBg(file);
            window.dispatchEvent(new Event("rollingpebble:workspace-bg-changed"));
            toastPubSub.pub({ type: "success", text: t.messages.bgUpdated });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    const resetBg = async () => {
        setBusy(true);
        try {
            await deleteWorkspaceBg();
            window.dispatchEvent(new Event("rollingpebble:workspace-bg-changed"));
            toastPubSub.pub({ type: "success", text: t.messages.bgReset });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    const resetDisplayPrefs = () => {
        prefDispatch({ type: "lang", payload: "en-US" });
        prefDispatch({ type: "themeMode", payload: ThemeMode.dark });
        prefDispatch({ type: "themeColor", payload: themeColors.logic });
        prefDispatch({ type: "fixed", payload: 3 });
        prefDispatch({ type: "spaceStart", payload: 1 });
        prefDispatch({ type: "spaceEnd", payload: 0 });
        prefDispatch({ type: "builtInAudio", payload: false });
        prefDispatch({ type: "showWaveform", payload: true });
        prefDispatch({ type: "screenButton", payload: false });
        toastPubSub.pub({ type: "success", text: u.displayPrefsReset });
    };

    return {
        bgInputRef,
        hexInput,
        setHexInput,
        onBgUpload,
        resetBg,
        resetDisplayPrefs,
    };
}
