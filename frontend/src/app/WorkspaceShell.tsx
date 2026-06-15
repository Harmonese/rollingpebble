import { useCallback, useContext, useState } from "react";
import { LrclibPanel } from "../features/lrclib/LrclibPanel.js";
import { ImportAudioPanel } from "../features/project/ImportAudioPanel.js";
import { ProjectPanel } from "../features/project/ProjectPanel.js";
import { RollerPanel } from "../features/roller/RollerPanel.js";
import { UploadPanel } from "../features/upload/UploadPanel.js";
import { LrcUtilsPanel } from "../features/lrc-utils/LrcUtilsPanel.js";
import { useLyricsDocument } from "./lyrics/useLyricsDocument.js";
import { useProjectWorkspace } from "./projects/useProjectWorkspace.js";
import { useTextFileDrop } from "../hooks/useTextFileDrop.js";
import type { ProjectModel } from "../shared/api/types.js";
import { appContext } from "../shared/appContext.js";
import { LyricsWorkspace } from "./lyrics/LyricsWorkspace.js";
import "./workspace.css";

export const WorkspaceShell: React.FC = () => {
    const { prefState, lang, trimOptions } = useContext(appContext);
    const { project, setProject } = useProjectWorkspace();
    const [utilsOpen, setUtilsOpen] = useState(false);
    const lyrics = useLyricsDocument({ trimOptions, prefState, project });

    const onProject = useCallback((next: ProjectModel, applyToEditor = false) => {
        setProject(next);
        if (applyToEditor) lyrics.importProject(next);
    }, [setProject, lyrics.importProject]);

    useTextFileDrop(lyrics.importText);

    return (
        <main className="workspace-shell studio-main">
            <aside className="workspace-rail workspace-rail-left studio-side left">
                <ProjectPanel project={project} onProject={onProject} />
                <ImportAudioPanel project={project} onProject={onProject} />
                <LrclibPanel
                    project={project}
                    editorMeta={lyrics.editorMeta}
                    onProject={onProject}
                    onImportText={lyrics.importText}
                />
            </aside>

            <LyricsWorkspace
                lang={lang}
                state={lyrics.state}
                dispatch={lyrics.dispatch}
                includeMetadataTags={lyrics.includeMetadataTags}
                onOpenUtils={() => setUtilsOpen(true)}
            />

            <aside className="workspace-rail workspace-rail-right studio-side right">
                <RollerPanel
                    project={project}
                    plainLyrics={lyrics.plainLyrics}
                    syncedLyrics={lyrics.syncedLyrics}
                    editorMeta={lyrics.editorMeta}
                    onProject={onProject}
                    onImportText={lyrics.importText}
                />
                <UploadPanel
                    project={project}
                    plainLyrics={lyrics.plainLyrics}
                    syncedLyrics={lyrics.syncedLyrics}
                    editorMeta={lyrics.editorMeta}
                    onProject={onProject}
                />
            </aside>

            <LrcUtilsPanel
                open={utilsOpen}
                text={lyrics.syncedLyrics}
                onClose={() => setUtilsOpen(false)}
                onApply={(newText) => {
                    lyrics.importText(newText);
                    setUtilsOpen(false);
                }}
            />
        </main>
    );
};
