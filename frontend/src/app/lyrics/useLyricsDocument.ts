import { useCallback, useEffect } from "react";
import { useAudioDurationEffect } from "../../domain/audio/useAudioTimeline.js";
import { useEditorMetadataSetting } from "../../hooks/useEditorMetadataSetting.js";
import type { ProjectModel } from "../../shared/api/types.js";
import { editorStorageKeys, readLocalText, readSessionNumber, writeLocalText, writeSessionText } from "../../storage/browserStorage.js";
import {
    convertTimeToTag,
    LyricsDocumentActionType,
    lyricsDocumentMeta,
    lyricsDocumentPlainText,
    lyricsDocumentSyncedText,
    useLyricsEngine,
} from "../../domain/lyrics/lyricsDocument.js";
import type { LyricsTrimOptions } from "../../domain/lyrics/types.js";
import { buildImportTextFromProject } from "../../shared/lrc.js";

function fixedValue(value: unknown): Fixed {
    return value === 0 || value === 1 || value === 2 || value === 3 ? value : 3;
}

export function useLyricsDocument(args: {
    trimOptions: LyricsTrimOptions;
    prefState: unknown;
    project: ProjectModel | null;
}) {
    const includeMetadataTags = useEditorMetadataSetting();
    const [state, dispatch] = useLyricsEngine(() => ({
        text: readLocalText(editorStorageKeys.lyric, editorStorageKeys.empty),
        options: args.trimOptions,
        select: readSessionNumber(editorStorageKeys.selectIndex, 0),
    }));

    const importText = useCallback((text: string) => {
        dispatch({ type: LyricsDocumentActionType.parse, payload: { text, options: args.trimOptions } });
    }, [dispatch, args.trimOptions]);

    const importProject = useCallback((project: ProjectModel) => {
        importText(buildImportTextFromProject(project));
    }, [importText]);

    useAudioDurationEffect(
        useCallback((duration) => {
            dispatch({
                type: LyricsDocumentActionType.info,
                payload: { name: "length", value: convertTimeToTag(duration, fixedValue((args.prefState as { fixed?: number }).fixed), false) },
            });
        }, [dispatch, args.prefState]),
    );

    useEffect(() => {
        const saveState = (): void => {
            writeLocalText(editorStorageKeys.lyric, lyricsDocumentSyncedText(state, args.prefState, includeMetadataTags));
            writeSessionText(editorStorageKeys.selectIndex, state.selectIndex.toString());
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
    }, [state, args.prefState, includeMetadataTags]);

    return {
        state,
        dispatch,
        includeMetadataTags,
        importText,
        importProject,
        editorMeta: lyricsDocumentMeta(state, args.project),
        plainLyrics: lyricsDocumentPlainText(state),
        syncedLyrics: lyricsDocumentSyncedText(state, args.prefState, includeMetadataTags),
    };
}
