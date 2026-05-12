import LSK from "#const/local_key.json" with { type: "json" };
import SSK from "#const/session_key.json" with { type: "json" };
import STRINGS from "#const/strings.json" with { type: "json" };
import { convertTimeToTag } from "@lrc-maker/lrc-parser";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ProjectPanel } from "../features/project/ProjectPanel.js";
import { LrclibPanel } from "../features/lrclib/LrclibPanel.js";
import { RollerPanel } from "../features/roller/RollerPanel.js";
import { UploadPanel } from "../features/upload/UploadPanel.js";
import type { ProjectModel } from "../shared/api.js";
import { buildImportTextFromProject, metaFromState, plainFromState, syncedFromState } from "../shared/lrc.js";
import { ActionType as LrcActionType, useLrc } from "../hooks/useLrc.js";
import { ThemeMode } from "../hooks/usePref.js";
import { AudioActionType, audioStatePubSub } from "../utils/audiomodule.js";
import { appContext } from "./app.context.js";
import { Eidtor } from "./editor.js";
import { Synchronizer } from "./synchronizer.js";
import { AkariNotFound } from "./svg.img.js";
import "./roller.css";

export const Content: React.FC = () => {
    const self = useRef(Symbol(Content.name));
    const { prefState, trimOptions } = useContext(appContext);
    const [active, setActive] = useState<"sync" | "editor">("sync");
    const [project, setProject] = useState<ProjectModel | null>(null);

    const [lrcState, lrcDispatch] = useLrc(() => ({
        text: localStorage.getItem(LSK.lyric) || STRINGS.emptyString,
        options: trimOptions,
        select: Number.parseInt(sessionStorage.getItem(SSK.selectIndex)!, 10) || 0,
    }));

    useEffect(() => {
        return audioStatePubSub.sub(self.current, (data) => {
            if (data.type === AudioActionType.getDuration) {
                lrcDispatch({
                    type: LrcActionType.info,
                    payload: { name: "length", value: convertTimeToTag(data.payload, prefState.fixed, false) },
                });
            }
        });
    }, [lrcDispatch, prefState.fixed]);

    useEffect(() => {
        const saveState = (): void => {
            const text = syncedFromState(lrcState, prefState);
            localStorage.setItem(LSK.lyric, text);
            sessionStorage.setItem(SSK.selectIndex, lrcState.selectIndex.toString());
            localStorage.setItem(LSK.preferences, JSON.stringify(prefState));
        };
        const onVisibilitychange = () => {
            if (document.hidden) saveState();
        };
        document.addEventListener("visibilitychange", onVisibilitychange);
        window.addEventListener("beforeunload", saveState);
        return () => {
            document.removeEventListener("visibilitychange", onVisibilitychange);
            window.removeEventListener("beforeunload", saveState);
        };
    }, [lrcState, prefState]);

    useEffect(() => {
        const onDrop = (ev: DragEvent) => {
            const file = ev.dataTransfer?.files[0];
            if (file && (file.type.startsWith("text/") || /(?:\.lrc|\.txt)$/i.test(file.name))) {
                const fileReader = new FileReader();
                fileReader.addEventListener("load", () => {
                    importText(fileReader.result as string);
                }, { once: true });
                fileReader.readAsText(file, "utf-8");
            }
        };
        document.documentElement.addEventListener("drop", onDrop);
        return () => document.documentElement.removeEventListener("drop", onDrop);
    }, []);

    useEffect(() => {
        const values = {
            [ThemeMode.auto]: "auto",
            [ThemeMode.light]: "light",
            [ThemeMode.dark]: "dark",
        } as const;
        document.documentElement.dataset.theme = values[prefState.themeMode];
    }, [prefState.themeMode]);

    useEffect(() => {
        const rgb = hex2rgb(prefState.themeColor);
        document.documentElement.style.setProperty("--theme-rgb", rgb.join(", "));
        const lum = luminanace(...rgb);
        const con = lum + 0.05;
        document.documentElement.style.setProperty("--theme-contrast-color", con * con > 0.0525 ? "var(--black)" : "var(--white)");
    }, [prefState.themeColor]);

    const importText = useCallback((text: string) => {
        lrcDispatch({ type: LrcActionType.parse, payload: { text, options: trimOptions } });
        setActive("sync");
    }, [lrcDispatch, trimOptions]);

    const onProject = useCallback((next: ProjectModel, applyToEditor = false) => {
        setProject(next);
        if (applyToEditor) {
            importText(buildImportTextFromProject(next));
        }
    }, [importText]);

    const editorMeta = useMemo(() => {
        const current = metaFromState(lrcState);
        return {
            track: current.track || project?.metadata.track || "",
            artist: current.artist || project?.metadata.artist || "",
            album: current.album || project?.metadata.album || "",
            duration: current.duration || project?.metadata.duration || 0,
        };
    }, [lrcState, project]);

    const plainLyrics = useMemo(() => plainFromState(lrcState), [lrcState]);
    const syncedLyrics = useMemo(() => syncedFromState(lrcState, prefState), [lrcState, prefState]);

    return (
        <main className="roller-main">
            <aside className="roller-side left">
                <ProjectPanel project={project} onProject={onProject} />
                <LrclibPanel project={project} editorMeta={editorMeta} onProject={onProject} onImportText={importText} />
            </aside>

            <section className="roller-center">
                <div className="roller-tabs">
                    <button className={active === "sync" ? "active" : ""} type="button" onClick={() => setActive("sync")}>Synchronizer</button>
                    <button className={active === "editor" ? "active" : ""} type="button" onClick={() => setActive("editor")}>Editor</button>
                </div>
                <div className="roller-editor-host">
                    {active === "sync"
                        ? (lrcState.lyric.length ? <Synchronizer state={lrcState} dispatch={lrcDispatch} /> : <AkariNotFound />)
                        : <Eidtor lrcState={lrcState} lrcDispatch={lrcDispatch} />}
                </div>
            </section>

            <aside className="roller-side right">
                <RollerPanel
                    project={project}
                    plainLyrics={plainLyrics}
                    syncedLyrics={syncedLyrics}
                    editorMeta={editorMeta}
                    onProject={onProject}
                    onImportText={importText}
                />
                <UploadPanel
                    project={project}
                    plainLyrics={plainLyrics}
                    syncedLyrics={syncedLyrics}
                    editorMeta={editorMeta}
                    onProject={onProject}
                />
            </aside>
        </main>
    );
};

const luminanace = (...rgb: [number, number, number]): number => {
    return rgb
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
        .reduce((p, c, i) => p + c * [0.2126, 0.7152, 0.0722][i], 0);
};

const hex2rgb = (hex: string): [number, number, number] => {
    hex = hex.slice(1);
    const value = Number.parseInt(hex, 16);
    return [(value >> 0x10) & 0xff, (value >> 0x08) & 0xff, value & 0xff];
};
