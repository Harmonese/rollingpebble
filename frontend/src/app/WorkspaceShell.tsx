import { useContext, useState } from "react";
import { LrcUtilsPanel } from "../features/lrc-utils/LrcUtilsPanel.js";
import { LrclibPanel } from "../features/lrclib/LrclibPanel.js";
import { ImportAudioPanel } from "../features/project/ImportAudioPanel.js";
import { ProjectPanel } from "../features/project/ProjectPanel.js";
import { RollerPanel } from "../features/roller/RollerPanel.js";
import { UploadPanel } from "../features/upload/UploadPanel.js";
import { useTextFileDrop } from "../hooks/useTextFileDrop.js";
import { appContext } from "../shared/appContext.js";
import { LyricsWorkspace } from "./lyrics/LyricsWorkspace.js";
import { useProjectWorkspace } from "./projects/useProjectWorkspace.js";
import "./workspace.css";

export const WorkspaceShell: React.FC = () => {
    const { prefState, lang, trimOptions } = useContext(appContext);
    const workspace = useProjectWorkspace({ trimOptions, prefState, lang });
    const { project, lyrics } = workspace;
    const [utilsOpen, setUtilsOpen] = useState(false);
    useTextFileDrop(workspace.importLyrics);

    return (
        <main className="workspace-shell studio-main">
            <aside className="workspace-rail workspace-rail-left studio-side left">
                <ProjectPanel
                    project={project}
                    onOpenProject={workspace.openProject}
                    onSave={workspace.save}
                    draftAudioName={workspace.file?.name}
                    draftMetadata={workspace.canSave ? lyrics.editorMeta : undefined}
                    draftSource={workspace.canSave ? workspace.source : undefined}
                    dirty={workspace.dirty}
                    canSave={workspace.canSave}
                    saving={workspace.saving}
                    transitioning={workspace.transitioning}
                />
                <ImportAudioPanel
                    project={project}
                    onImportAudio={workspace.importAudio}
                    disabled={workspace.saving || workspace.transitioning}
                />
                <LrclibPanel
                    project={project}
                    editorMeta={lyrics.editorMeta}
                    onImportText={workspace.importLyrics}
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
                    draftAudioReady={Boolean(workspace.file)}
                    saveWorkspace={workspace.save}
                    workspaceId={workspace.workspaceId}
                    workspaceSignature={workspace.signature}
                    onJobResult={workspace.applyJobResult}
                    workspaceBusy={workspace.saving || workspace.transitioning}
                />
                <UploadPanel
                    project={project}
                    plainLyrics={lyrics.plainLyrics}
                    syncedLyrics={lyrics.syncedLyrics}
                    editorMeta={lyrics.editorMeta}
                    onSave={workspace.save}
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
