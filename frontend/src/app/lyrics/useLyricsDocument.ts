import { parser } from "@lrc-maker/lrc-parser";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAudioDurationEffect } from "../../domain/audio/useAudioTimeline.js";
import {
    convertTimeToTag,
    type LyricsDocumentAction,
    LyricsDocumentActionType,
    lyricsDocumentMeta,
    lyricsDocumentPlainText,
    lyricsDocumentSyncedText,
    useLyricsEngine,
} from "../../domain/lyrics/lyricsDocument.js";
import {
    hasTranslation,
    type LyricDocument,
    reconcileLines,
    restoreDocument,
} from "../../domain/lyrics/translationDocument.js";
import type { LyricsTrimOptions } from "../../domain/lyrics/types.js";
import { useEditorMetadataSetting } from "../../hooks/useEditorMetadataSetting.js";
import type { MetadataSources, ProjectModel } from "../../shared/api/types.js";
import { appContext } from "../../shared/appContext.js";
import { editorDraftError } from "../../shared/editorDraft.js";
import { buildImportTextFromProject } from "../../shared/lrc.js";
import {
    editorStorageKeys,
    readLocalText,
    readSessionNumber,
    writeLocalText,
    writeSessionText,
} from "../../storage/browserStorage.js";
import { useConfirmDialog } from "../../ui/ConfirmDialog.js";

const desktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const fields = { ti: "track", ar: "artist", al: "album" } as const;

function fixedValue(value: unknown): Fixed {
    return value === 0 || value === 1 || value === 2 || value === 3 ? value : 3;
}

export function useLyricsDocument(args: {
    trimOptions: LyricsTrimOptions;
    prefState: unknown;
}) {
    const includeMetadataTags = useEditorMetadataSetting();
    const { lang } = useContext(appContext);
    const confirm = useConfirmDialog();
    const [state, rawDispatch] = useLyricsEngine(() => ({
        text: desktop ? "" : readLocalText(editorStorageKeys.lyric, editorStorageKeys.empty),
        options: args.trimOptions,
        select: readSessionNumber(editorStorageKeys.selectIndex, 0),
    }));

    const [metadataSources, setMetadataSources] = useState<MetadataSources>(() =>
        Object.fromEntries(
            Object.entries(fields).filter(([tag]) => state.info.has(tag)).map(([, key]) => [key, "manual"]),
        )
    );
    const current = useRef({ state, metadataSources });
    current.current = { state, metadataSources };
    const updateSources = useCallback((sources: MetadataSources) => {
        current.current.metadataSources = sources;
        setMetadataSources(sources);
    }, []);
    const applyAction = useCallback((action: LyricsDocumentAction) => {
        const sources = { ...current.current.metadataSources };
        if (action.type === LyricsDocumentActionType.info) {
            const key = fields[action.payload.name as keyof typeof fields];
            if (key) sources[key] = "manual";
        } else if (action.type === LyricsDocumentActionType.parse) {
            const next = parser(action.payload.text, action.payload.options).info;
            for (const [tag, key] of Object.entries(fields)) {
                const before = current.current.state.info.get(tag) || "";
                const after = next.get(tag) ?? (action.payload.preserveMetadata ? before : "");
                if (action.payload.metadataOrigin === "lyrics") {
                    if (next.has(tag) || new RegExp("\\[" + tag + ":").test(action.payload.text)) {
                        sources[key] = "lyrics";
                    }
                } else if (before !== after) sources[key] = "manual";
            }
        }
        if (Object.values(fields).some(key => sources[key] !== current.current.metadataSources[key])) {
            updateSources(sources);
        }
        rawDispatch(action);
        if (action.type === LyricsDocumentActionType.parse && action.payload.metadataOrigin === "lyrics") {
            for (const tag of Object.keys(fields)) {
                if (new RegExp("\\[" + tag + ":\\s*\\]").test(action.payload.text)) {
                    rawDispatch({ type: LyricsDocumentActionType.info, payload: { name: tag, value: "" } });
                }
            }
        }
    }, [rawDispatch, updateSources]);

    const guarded = useRef(false);
    const dispatch = useCallback((action: LyricsDocumentAction) => {
        if (action.type === LyricsDocumentActionType.parse && editorDraftError()) return;
        if (
            action.type !== LyricsDocumentActionType.parse || action.payload.undoable
            || !hasTranslation(current.current.state.lyric)
        ) {
            applyAction(action);
            return;
        }
        if (guarded.current) return;
        const captured = current.current.state;
        const lost = action.payload.preserveTranslation
            ? reconcileLines(captured.lyric, parser(action.payload.text, action.payload.options).lyric).lost
            : captured.lyric.filter(line => line.translation).length;
        if (!lost) {
            applyAction(action);
            return;
        }
        guarded.current = true;
        void confirm({ message: lang.translation.clearAffected.replace("{count}", String(lost)) }).then(choice => {
            if (choice === "confirm" && current.current.state.lyric === captured.lyric) {
                applyAction({ ...action, payload: { ...action.payload, undoable: true } });
            }
        }).finally(() => {
            guarded.current = false;
        });
    }, [applyAction, confirm, lang.translation.clearAffected]);

    const importText = useCallback(async (text: string, preserveMetadata = false, force = false) => {
        if (editorDraftError()) return false;
        const captured = current.current.state;
        if (!force && hasTranslation(captured.lyric)) {
            if (
                await confirm({ message: lang.translation.replaceDocument }) !== "confirm"
                || current.current.state.lyric !== captured.lyric
            ) return false;
        }
        const info = parser(text, args.trimOptions).info;
        const sources = preserveMetadata ? { ...current.current.metadataSources } : {};
        for (const [tag, key] of Object.entries(fields)) {
            // Explicit empty tags also protect an intentionally cleared value.
            if (info.has(tag) || new RegExp("\\[" + tag + ":").test(text)) sources[key] = "lyrics";
        }
        updateSources(sources);
        rawDispatch({
            type: LyricsDocumentActionType.parse,
            payload: { text, options: args.trimOptions, preserveMetadata },
        });
        for (const tag of Object.keys(fields)) {
            if (new RegExp("\\[" + tag + ":\\s*\\]").test(text) && !info.get(tag)) {
                rawDispatch({ type: LyricsDocumentActionType.info, payload: { name: tag, value: "" } });
            }
        }
        return true;
    }, [rawDispatch, args.trimOptions, updateSources, confirm, lang.translation.replaceDocument]);

    const importProject = useCallback((project: ProjectModel) => {
        rawDispatch({
            type: LyricsDocumentActionType.parse,
            payload: { text: buildImportTextFromProject(project), options: args.trimOptions },
        });
        const lines = restoreDocument(
            project.lyric_document,
            project.synced_lyrics,
            parser(buildImportTextFromProject(project), args.trimOptions).lyric,
        );
        if (lines) {
            rawDispatch({
                type: LyricsDocumentActionType.restoreTranslation,
                payload: { lines, target: project.lyric_document!.target_language },
            });
        }
        updateSources(Object.fromEntries(
            Object.values(fields).map(key => [
                key,
                project.metadata_sources?.[key] || (project.metadata[key] ? "manual" : null),
            ]),
        ));
    }, [rawDispatch, args.trimOptions, updateSources]);

    useEffect(() => {
        if (desktop) return;
        try {
            const saved = JSON.parse(localStorage.getItem("rollingpebble.lyric-document") || "null") as
                | LyricDocument
                | null;
            const source = readLocalText(editorStorageKeys.lyric, editorStorageKeys.empty);
            const lines = restoreDocument(saved, source, current.current.state.lyric);
            if (lines) {
                rawDispatch({
                    type: LyricsDocumentActionType.restoreTranslation,
                    payload: { lines, target: saved!.target_language },
                });
            }
        } catch { /* Invalid recovery data must never bind translations to unrelated lyrics. */ }
    }, [rawDispatch]);

    useAudioDurationEffect(
        useCallback((duration) => {
            if (!Number.isFinite(duration) || duration <= 0) return;
            rawDispatch({
                type: LyricsDocumentActionType.info,
                payload: {
                    name: "length",
                    value: convertTimeToTag(duration, fixedValue((args.prefState as { fixed?: number }).fixed), false),
                },
            });
        }, [rawDispatch, args.prefState]),
    );

    useEffect(() => {
        const saveState = (): void => {
            if (desktop) return;
            const source = lyricsDocumentSyncedText(state, args.prefState, includeMetadataTags);
            localStorage.setItem(
                "rollingpebble.lyric-document",
                JSON.stringify({
                    version: 1,
                    source_lrc: source,
                    target_language: state.targetLanguage || "",
                    lines: state.lyric,
                }),
            );
            writeLocalText(
                editorStorageKeys.lyric,
                lyricsDocumentSyncedText(state, args.prefState, includeMetadataTags),
            );
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
        rawDispatch,
        metadataSources,
        updateSources,
        includeMetadataTags,
        importText,
        importProject,
        editorMeta: lyricsDocumentMeta(state),
        plainLyrics: lyricsDocumentPlainText(state),
        syncedLyrics: lyricsDocumentSyncedText(state, args.prefState, includeMetadataTags),
        document: {
            version: 1,
            source_lrc: lyricsDocumentSyncedText(state, args.prefState, includeMetadataTags),
            target_language: state.targetLanguage || "",
            lines: state.lyric,
        } as LyricDocument,
    };
}
