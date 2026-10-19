import { useCallback, useEffect, useRef, useState } from "react";
import type { LyricsDocumentAction, LyricsDocumentState } from "../../domain/lyrics/lyricsDocument.js";
import { LyricsDocumentActionType as ActionType } from "../../domain/lyrics/lyricsDocument.js";
import { hasTranslation } from "../../domain/lyrics/translationDocument.js";
import { LyricsEditor } from "../../features/lyrics/LyricsEditor.js";
import { LyricsSynchronizer } from "../../features/lyrics/LyricsSynchronizer.js";
import { LyricMarks } from "../../features/lyrics/parts/LyricMarks.js";
import type { TranslationController } from "../../features/translation/useTranslation.js";
import { useAudio } from "../../hooks/useAudio.js";
import { editorDraftError, readEditorRecovery } from "../../shared/editorDraft.js";
import { Button } from "../../ui/Button.js";
import { Tabs } from "../../ui/Tabs.js";

export const LyricsWorkspace: React.FC<{
    lang: Language;
    state: LyricsDocumentState;
    dispatch: React.Dispatch<LyricsDocumentAction>;
    includeMetadataTags: boolean;
    onOpenUtils: () => void;
    preview?: React.ReactNode;
    readOnly?: boolean;
    translation?: TranslationController;
}> = ({ lang, state, dispatch, includeMetadataTags, onOpenUtils, preview, readOnly = false, translation }) => {
    const [showTranslation, setShowTranslation] = useState(true);
    const locked = useRef(readOnly);
    locked.current = readOnly;
    const safeDispatch = useCallback((action: LyricsDocumentAction) => {
        if (!locked.current || action.type === ActionType.select) dispatch(action);
    }, [dispatch]);
    const [active, setActive] = useState<"sync" | "editor" | "preview">(() =>
        translation && readEditorRecovery() ? "editor" : "sync"
    );
    useEffect(() => {
        if (!preview && active === "preview") setActive("sync");
    }, [Boolean(preview), active]);
    const audio = useAudio();
    const text = state.lyric[state.selectIndex]?.text;
    const marked = state.marks.some((mark) => mark.text === text);

    return (
        <section
            className="lyrics-workspace studio-center"
            onDrop={readOnly
                ? event => {
                    event.preventDefault();
                    event.stopPropagation();
                }
                : undefined}
        >
            <div className="studio-center-tabs">
                <Tabs
                    ariaLabel={lang.ui.editor}
                    items={[{ value: "sync", label: lang.ui.synchronizer }, {
                        value: "editor",
                        label: lang.ui.editor,
                    }, ...(preview ? [{ value: "preview" as const, label: lang.timingV2.preview }] : [])]}
                    value={active}
                    onChange={value => {
                        if (!editorDraftError()) setActive(value);
                    }}
                />
                {active !== "preview" && (
                    <div className="lyric-mark-actions">
                        {translation && active === "sync" && hasTranslation(state.lyric) && (
                            <Button
                                aria-pressed={showTranslation}
                                onClick={() => setShowTranslation(value => !value)}
                            >
                                {lang.translation.translation}
                            </Button>
                        )}
                        <Button
                            disabled={readOnly || active !== "sync" || !text?.trim() || marked}
                            title={lang.ui.markCurrentLine}
                            onClick={() => safeDispatch({ type: ActionType.markLine, payload: {} })}
                        >
                            {lang.ui.mark}
                        </Button>
                        <Button
                            disabled={readOnly || active !== "sync" || !marked}
                            title={lang.ui.clearLyricMark}
                            onClick={() => safeDispatch({ type: ActionType.unmarkLine, payload: {} })}
                        >
                            {lang.ui.unmark}
                        </Button>
                    </div>
                )}
            </div>
            {active !== "preview" && (
                <LyricMarks
                    marks={state.marks}
                    labels={lang.ui}
                    disabled={readOnly || active !== "sync" || !audio.duration}
                    insert={(slot) => {
                        if (active === "sync" && audio.duration) {
                            safeDispatch({
                                type: ActionType.insertMarkedLine,
                                payload: { slot, time: audio.currentTime },
                            });
                        }
                    }}
                />
            )}
            <div className="studio-editor-host">
                {active === "preview"
                    ? preview
                    : active === "sync"
                    ? (
                        <LyricsSynchronizer
                            state={state}
                            dispatch={safeDispatch}
                            readOnly={readOnly}
                            showTranslation={showTranslation}
                        />
                    )
                    : (
                        <LyricsEditor
                            lrcState={state}
                            lrcDispatch={safeDispatch}
                            readOnly={readOnly}
                            includeMetadataTags={includeMetadataTags}
                            onOpenUtils={onOpenUtils}
                            translation={translation}
                        />
                    )}
            </div>
        </section>
    );
};
