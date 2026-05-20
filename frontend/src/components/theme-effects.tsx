import { useContext, useEffect, useState } from "react";
import { ThemeMode } from "../hooks/usePref.js";
import { SETTINGS_UPDATED_EVENT } from "../shared/settingsEvents.js";
import { appContext, ChangBits } from "./app.context.js";

const themeModeValues = {
    [ThemeMode.auto]: "auto",
    [ThemeMode.light]: "light",
    [ThemeMode.dark]: "dark",
} as const;

const luminance = (...rgb: [number, number, number]): number => {
    return rgb
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
        .reduce((p, c, i) => p + c * [0.2126, 0.7152, 0.0722][i], 0);
};

const hexToRgb = (hex: string): [number, number, number] => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
        return [35, 209, 139];
    }
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 0x10) & 0xff, (value >> 0x08) & 0xff, value & 0xff];
};

export const ThemeEffects: React.FC = () => {
    const { prefState } = useContext(appContext, ChangBits.prefState);
    const [bgVersion, setBgVersion] = useState(Date.now());

    useEffect(() => {
        document.documentElement.dataset.theme = themeModeValues[prefState.themeMode];
    }, [prefState.themeMode]);

    useEffect(() => {
        const rgb = hexToRgb(prefState.themeColor);
        document.documentElement.style.setProperty("--theme-rgb", rgb.join(", "));
        const contrastBase = luminance(...rgb) + 0.05;
        document.documentElement.style.setProperty("--theme-contrast-color", contrastBase * contrastBase > 0.0525 ? "var(--black)" : "var(--white)");
    }, [prefState.themeColor]);

    useEffect(() => {
        let el = document.getElementById("workspace-bg-style") as HTMLStyleElement | null;
        if (!el) {
            el = document.createElement("style");
            el.id = "workspace-bg-style";
            document.head.appendChild(el);
        }
        el.textContent = `.roller-editor-host { background: radial-gradient(circle at 58% 46%, rgba(var(--theme-rgb), 0.08), transparent 38%), var(--editor-bg-overlay), url(/api/settings/workspace-bg?v=${bgVersion}), var(--roller-bg); background-repeat: no-repeat, no-repeat, no-repeat, repeat; background-position: center center, center center, center center, center center; background-size: auto, auto, cover, auto; }`;
        return () => {
            const existing = document.getElementById("workspace-bg-style");
            if (existing) existing.remove();
        };
    }, [bgVersion]);

    useEffect(() => {
        const handler = () => setBgVersion(Date.now());
        window.addEventListener(SETTINGS_UPDATED_EVENT, handler);
        window.addEventListener("rollingpebble:workspace-bg-changed", handler);
        return () => {
            window.removeEventListener(SETTINGS_UPDATED_EVENT, handler);
            window.removeEventListener("rollingpebble:workspace-bg-changed", handler);
        };
    }, []);

    return null;
};
