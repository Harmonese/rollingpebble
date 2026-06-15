import { useState } from "react";
import { LyricsEditor } from "../../features/lyrics/LyricsEditor.js";
import { LyricsSynchronizer } from "../../features/lyrics/LyricsSynchronizer.js";
import type { LyricsDocumentAction, LyricsDocumentState } from "../../domain/lyrics/lyricsDocument.js";
import { LrcRollerEmptyState } from "../branding/Illustrations.js";
import { Tabs } from "../../ui/Tabs.js";

export const LyricsWorkspace: React.FC<{
    lang: Language;
    state: LyricsDocumentState;
    dispatch: React.Dispatch<LyricsDocumentAction>;
    includeMetadataTags: boolean;
    onOpenUtils: () => void;
}> = ({ lang, state, dispatch, includeMetadataTags, onOpenUtils }) => {
    const [active, setActive] = useState<"sync" | "editor">("sync");

    return (
        <section className="lyrics-workspace studio-center">
            <div className="studio-center-tabs">
                <Tabs
                    ariaLabel={lang.ui.editor}
                    items={[{ value: "sync", label: lang.ui.synchronizer }, {
                        value: "editor",
                        label: lang.ui.editor,
                    }]}
                    value={active}
                    onChange={setActive}
                />
            </div>
            <div className="studio-editor-host">
                {active === "sync"
                    ? (state.lyric.length
                        ? <LyricsSynchronizer state={state} dispatch={dispatch} />
                        : <LrcRollerEmptyState label={lang.ui.noLyrics} />)
                    : (
                        <LyricsEditor
                            lrcState={state}
                            lrcDispatch={dispatch}
                            includeMetadataTags={includeMetadataTags}
                            onOpenUtils={onOpenUtils}
                        />
                    )}
            </div>
        </section>
    );
};
