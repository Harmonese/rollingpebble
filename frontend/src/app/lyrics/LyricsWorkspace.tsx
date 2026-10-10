import { useState } from "react";
import type { LyricsDocumentAction, LyricsDocumentState } from "../../domain/lyrics/lyricsDocument.js";
import { LyricsDocumentActionType as ActionType } from "../../domain/lyrics/lyricsDocument.js";
import { LyricsEditor } from "../../features/lyrics/LyricsEditor.js";
import { LyricsSynchronizer } from "../../features/lyrics/LyricsSynchronizer.js";
import { LyricMarks } from "../../features/lyrics/parts/LyricMarks.js";
import { useAudio } from "../../hooks/useAudio.js";
import { Button } from "../../ui/Button.js";
import { Tabs } from "../../ui/Tabs.js";

export const LyricsWorkspace: React.FC<{
    lang: Language;
    state: LyricsDocumentState;
    dispatch: React.Dispatch<LyricsDocumentAction>;
    includeMetadataTags: boolean;
    onOpenUtils: () => void;
}> = ({ lang, state, dispatch, includeMetadataTags, onOpenUtils }) => {
    const [active, setActive] = useState<"sync" | "editor">("sync");
    const audio = useAudio();
    const text = state.lyric[state.selectIndex]?.text;
    const marked = state.marks.some((mark) => mark.text === text);

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
                <div className="lyric-mark-actions">
                    <Button
                        disabled={active !== "sync" || !text?.trim() || marked}
                        title={lang.ui.markCurrentLine}
                        onClick={() => dispatch({ type: ActionType.markLine, payload: {} })}
                    >
                        {lang.ui.mark}
                    </Button>
                    <Button
                        disabled={active !== "sync" || !marked}
                        title={lang.ui.clearLyricMark}
                        onClick={() => dispatch({ type: ActionType.unmarkLine, payload: {} })}
                    >
                        {lang.ui.unmark}
                    </Button>
                </div>
            </div>
            <LyricMarks
                marks={state.marks}
                labels={lang.ui}
                disabled={active !== "sync" || !audio.duration}
                insert={(slot) => {
                    if (active === "sync" && audio.duration) {
                        dispatch({ type: ActionType.insertMarkedLine, payload: { slot, time: audio.currentTime } });
                    }
                }}
            />
            <div className="studio-editor-host">
                {active === "sync"
                    ? <LyricsSynchronizer state={state} dispatch={dispatch} />
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
