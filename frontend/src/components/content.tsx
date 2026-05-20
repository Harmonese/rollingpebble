import LSK from "#const/local_key.json" with { type: "json" };
import SSK from "#const/session_key.json" with { type: "json" };
import STRINGS from "#const/strings.json" with { type: "json" };
import { convertTimeToTag } from "@lrc-maker/lrc-parser";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { LrclibPanel } from "../features/lrclib/LrclibPanel.js";
import { ImportAudioPanel } from "../features/project/ImportAudioPanel.js";
import { ProjectPanel } from "../features/project/ProjectPanel.js";
import { RollerPanel } from "../features/roller/RollerPanel.js";
import { UploadPanel } from "../features/upload/UploadPanel.js";
import { LrcUtilsPanel } from "../features/utils/LrcUtilsPanel.js";
import { useEditorMetadataSetting } from "../hooks/useEditorMetadataSetting.js";
import { ActionType as LrcActionType, useLrc } from "../hooks/useLrc.js";
import { useTextFileDrop } from "../hooks/useTextFileDrop.js";
import type { ProjectModel } from "../shared/api.js";
import { buildImportTextFromProject, metaFromState, plainFromState, syncedFromState } from "../shared/lrc.js";
import { AudioActionType, audioStatePubSub } from "../utils/audiomodule.js";
import { appContext } from "./app.context.js";
import { Editor } from "./editor.js";
import { SegmentedTabs } from "./SegmentedTabs.js";
import { LrcRollerEmptyState } from "./svg.img.js";
import { Synchronizer } from "./synchronizer.js";
import "./roller.css";

export const Content: React.FC = () => {
    const self = useRef(Symbol(Content.name));
    const { prefState, lang, trimOptions } = useContext(appContext);
    const [active, setActive] = useState<"sync" | "editor">("sync");
    const [project, setProject] = useState<ProjectModel | null>(null);
    const includeMetadataTags = useEditorMetadataSetting();
    const [utilsOpen, setUtilsOpen] = useState(false);

    const [lrcState, lrcDispatch] = useLrc(() => ({
        text: localStorage.getItem(LSK.lyric) || STRINGS.emptyString,
        options: trimOptions,
        select: Number.parseInt(sessionStorage.getItem(SSK.selectIndex)!, 10) || 0,
    }));

    const importText = useCallback((text: string) => {
        lrcDispatch({ type: LrcActionType.parse, payload: { text, options: trimOptions } });
        setActive("sync");
    }, [lrcDispatch, trimOptions]);

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
            const text = syncedFromState(lrcState, prefState, includeMetadataTags);
            localStorage.setItem(LSK.lyric, text);
            sessionStorage.setItem(SSK.selectIndex, lrcState.selectIndex.toString());
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
    }, [lrcState, prefState, includeMetadataTags]);

    useTextFileDrop(importText);

    const applyText = useCallback((text: string) => {
        lrcDispatch({ type: LrcActionType.parse, payload: { text, options: trimOptions } });
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
    const syncedLyrics = useMemo(() => syncedFromState(lrcState, prefState, includeMetadataTags), [
        lrcState,
        prefState,
        includeMetadataTags,
    ]);

    return (
        <main className="roller-main">
            <aside className="roller-side left">
                <ProjectPanel project={project} onProject={onProject} />
                <ImportAudioPanel project={project} onProject={onProject} />
                <LrclibPanel
                    project={project}
                    editorMeta={editorMeta}
                    onProject={onProject}
                    onImportText={importText}
                />
            </aside>

            <section className="roller-center">
                <div className="roller-center-tabs">
                    <SegmentedTabs
                        ariaLabel={lang.ui.editor}
                        items={[{ value: "sync", label: lang.ui.synchronizer }, {
                            value: "editor",
                            label: lang.ui.editor,
                        }]}
                        value={active}
                        onChange={setActive}
                    />
                </div>
                <div className="roller-editor-host">
                    {active === "sync"
                        ? (lrcState.lyric.length
                            ? <Synchronizer state={lrcState} dispatch={lrcDispatch} />
                            : <LrcRollerEmptyState />)
                        : (
                            <Editor
                                lrcState={lrcState}
                                lrcDispatch={lrcDispatch}
                                includeMetadataTags={includeMetadataTags}
                                onOpenUtils={() => setUtilsOpen(true)}
                            />
                        )}
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
            <LrcUtilsPanel
                open={utilsOpen}
                text={syncedLyrics}
                onClose={() => setUtilsOpen(false)}
                onApply={(newText) => {
                    applyText(newText);
                    setUtilsOpen(false);
                }}
            />
        </main>
    );
};
