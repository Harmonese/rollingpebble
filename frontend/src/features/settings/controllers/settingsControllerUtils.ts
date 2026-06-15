import { backendMessageText } from "../../../shared/api/request.js";
import type { Language } from "../../../languages/index.js";
import { INTEGER_POSITIVE_ERROR, NUMERIC_POSITIVE_ERROR } from "../../../shared/numbers.js";
import { notifySettingsUpdated } from "../../../shared/settingsEvents.js";
import { toastPubSub } from "../../../ui/Toast.js";
import type { MessageType } from "../../../shared/messageTypes.js";
import { updateSettings } from "../../../shared/api/settings.js";

export type SettingsMessageSetter = (text: string, type?: MessageType | number, duration?: number) => void;

export type SettingsControllerContext = {
    lang: Language;
    setMessage: SettingsMessageSetter;
    setBusy: (busy: boolean) => void;
    refresh: (notify?: boolean) => Promise<void>;
};

export function settingsErrorText(
    error: unknown,
    messages: { numericPositive: string; integerPositive: string },
    backendMessages: Record<string, string | undefined>,
): string {
    const message = (error as Error).message;
    if (message === NUMERIC_POSITIVE_ERROR) return messages.numericPositive;
    if (message === INTEGER_POSITIVE_ERROR) return messages.integerPositive;
    return backendMessageText(error, backendMessages);
}

export async function saveSettingsPatch(
    context: SettingsControllerContext,
    payload: Record<string, unknown>,
    success?: string,
): Promise<void> {
    const { lang, refresh, setBusy, setMessage } = context;
    const t = lang.settings;
    setBusy(true);
    setMessage(t.messages.saving, "info");
    try {
        await updateSettings(payload);
        notifySettingsUpdated();
        await refresh();
        setMessage("");
        toastPubSub.pub({ type: "success", text: success || t.messages.saved });
    } catch (error) {
        setMessage(settingsErrorText(error, t.messages, lang.backendMessages), "error");
    } finally {
        setBusy(false);
    }
}
