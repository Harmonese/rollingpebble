import LSK from "#const/local_key.json" with { type: "json" };
import STRINGS from "#const/strings.json" with { type: "json" };
import { useEffect, useMemo } from "react";
import { appContext } from "../shared/appContext.js";
import { useLang } from "../hooks/useLang.js";
import { usePref } from "../hooks/usePref.js";
import { readLocalText, writeLocalText } from "../storage/browserStorage.js";
import { toastPubSub } from "../ui/Toast.js";

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [prefState, prefDispatch] = usePref(() => readLocalText(LSK.preferences, STRINGS.emptyString));

    const [lang, setLang] = useLang();

    useEffect(() => {
        setLang(prefState.lang).catch((error: Error) => {
            toastPubSub.pub({
                type: "warning",
                text: error.message,
            });
        });
    }, [setLang, prefState.lang]);

    useEffect(() => {
        writeLocalText(LSK.preferences, JSON.stringify(prefState));
    }, [prefState]);

    useEffect(() => {
        document.title = lang.app?.name || "Rolling Pebble";
        document.documentElement.lang = prefState.lang;
    }, [lang, prefState.lang]);

    const value = useMemo(() => {
        return {
            lang,
            prefState,
            prefDispatch,
            trimOptions: {
                trimStart: prefState.spaceStart >= 0,
                trimEnd: prefState.spaceEnd >= 0,
            },
        };
    }, [lang, prefDispatch, prefState]);

    return <appContext.Provider value={value}>{children}</appContext.Provider>;
};
