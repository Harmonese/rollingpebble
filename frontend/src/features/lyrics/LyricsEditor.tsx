import SSK from "#const/session_key.json" with { type: "json" };
import { parser } from "@lrc-maker/lrc-parser";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
    type LyricsDocumentAction as LrcAction,
    LyricsDocumentActionType as LrcActionType,
    type LyricsDocumentState as LrcState,
    lyricsDocumentSyncedText,
} from "../../domain/lyrics/lyricsDocument.js";
import { lrcFileName } from "../../domain/lyrics/lyricsFileName.js";
import { reconcileLines } from "../../domain/lyrics/translationDocument.js";
import { appContext } from "../../shared/appContext.js";
import {
    editorDraftError,
    readEditorRecovery,
    registerEditorCommit,
    setEditorRecovery,
} from "../../shared/editorDraft.js";
import { readSessionText, writeSessionText } from "../../storage/browserStorage.js";
import { useConfirmDialog } from "../../ui/ConfirmDialog.js";
import { CopySVG, DownloadSVG, OpenFileSVG, TranslationSVG, UtilitySVG } from "../../ui/icons.js";
import { toastPubSub } from "../../ui/Toast.js";
import { TranslationEditor } from "../translation/TranslationEditor.js";
import type { TranslationController } from "../translation/useTranslation.js";

const disableCheck = {
    autoCapitalize: "none",
    autoComplete: "off",
    autoCorrect: "off",
    spellCheck: false,
};

type HTMLInputLikeElement = HTMLInputElement & HTMLTextAreaElement;

type UseDefaultValue<T = React.RefObject<HTMLInputLikeElement>> = (
    defaultValue: string,
    ref?: T,
) => { defaultValue: string; ref: T };

const useDefaultValue: UseDefaultValue = (defaultValue, ref) => {
    const or = <T, K>(a: T, b: K): NonNullable<T> | K => a ?? b;

    const $ref = or(ref, useRef<HTMLInputLikeElement>(null));

    useEffect(() => {
        if ($ref.current) {
            // Background saves must not reformat the focused input or move its caret.
            if (document.activeElement === $ref.current) return;
            $ref.current.value = defaultValue;
        }
    }, [defaultValue, $ref]);
    return { ref: $ref, defaultValue };
};

export const LyricsEditor: React.FC<{
    lrcState: LrcState;
    lrcDispatch: React.Dispatch<LrcAction>;
    includeMetadataTags?: boolean;
    onOpenUtils?: () => void;
    readOnly?: boolean;
    translation?: TranslationController;
}> = ({ lrcState, lrcDispatch, includeMetadataTags = true, onOpenUtils, readOnly = false, translation }) => {
    const [bilingual, setBilingual] = useState(() => Boolean(translation && readEditorRecovery()?.mode === "paired"));
    const confirm = useConfirmDialog();
    const { prefState, trimOptions, lang } = useContext(appContext);
    const u = lang.ui;
    const locked = useRef(readOnly);
    locked.current = readOnly;
    const latestState = useRef(lrcState);
    latestState.current = lrcState;

    const metadataHeader = useCallback((): string => {
        return Array.from(lrcState.info.entries())
            .map(([name, value]) => `[${name}:${value}]`)
            .join("\n");
    }, [lrcState.info]);

    const parse = useCallback(
        async (ev: React.FocusEvent<HTMLTextAreaElement>) => {
            if (locked.current) return;
            const element = ev.target;
            const body = ev.target.value;
            const text = includeMetadataTags ? body : [metadataHeader(), body].filter(Boolean).join("\n");
            const lost = reconcileLines(lrcState.lyric, parser(text, trimOptions).lyric).lost;
            if (
                lost
                && await confirm({ message: lang.translation.clearAffected.replace("{count}", String(lost)) })
                    !== "confirm"
            ) {
                element.value = lyricsDocumentSyncedText(lrcState, prefState, includeMetadataTags);
                if (translation) setEditorRecovery(null);
                return;
            }
            if (locked.current || latestState.current.lyric !== lrcState.lyric) return;
            flushSync(() =>
                lrcDispatch({
                    type: LrcActionType.parse,
                    payload: {
                        text,
                        options: trimOptions,
                        preserveMarks: true,
                        preserveTranslation: true,
                        undoable: lost > 0,
                    },
                })
            );
            if (translation) setEditorRecovery(null);
        },
        [includeMetadataTags, lrcDispatch, metadataHeader, trimOptions, lrcState, confirm, lang.translation, prefState],
    );

    const setInfo = useCallback(
        (ev: React.FormEvent<HTMLElement>) => {
            if (locked.current) return;
            const { name, value } = ev.target as HTMLInputElement;
            lrcDispatch({
                type: LrcActionType.info,
                payload: { name, value },
            });
        },
        [lrcDispatch],
    );

    const text = lyricsDocumentSyncedText(lrcState, prefState, includeMetadataTags);

    const details = useRef<HTMLDetailsElement>(null);

    const onDetailsToggle = useCallback(() => {
        writeSessionText(SSK.editorDetailsOpen, details.current!.open.toString());
        setDetailsOpened(details.current!.open);
    }, []);

    const [detailsOpened, setDetailsOpened] = useState(() => {
        return readSessionText(SSK.editorDetailsOpen) !== "false";
    });

    const textarea = useRef<HTMLInputLikeElement>(null);
    const [href, setHref] = useState<string | undefined>(undefined);
    const exportText = () => {
        return textarea.current?.value ?? text;
    };

    useEffect(() => {
        const onBeforeUnload = () => {
            (document.activeElement as HTMLElement)?.blur();
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, []);

    const onDownloadClick = useCallback(() => {
        if (editorDraftError()) return;
        setHref((url) => {
            if (url) {
                URL.revokeObjectURL(url);
            }

            return URL.createObjectURL(
                new Blob([exportText()], {
                    type: "text/plain;charset=UTF-8",
                }),
            );
        });
    }, [text]);

    const [importing, setImporting] = useState(false);

    const onTextFileUpload = useCallback(
        (ev: React.ChangeEvent<HTMLInputElement>) => {
            if (locked.current || editorDraftError() || ev.target.files === null || ev.target.files.length === 0) {
                return;
            }

            setImporting(true);
            const fileReader = new FileReader();
            fileReader.addEventListener("load", () => {
                if (!locked.current) {
                    lrcDispatch({
                        type: LrcActionType.parse,
                        payload: {
                            text: fileReader.result as string,
                            options: trimOptions,
                            preserveMetadata: true,
                            metadataOrigin: "lyrics",
                        },
                    });
                }
                setImporting(false);
                ev.target.value = "";
            });
            fileReader.addEventListener("error", () => {
                setImporting(false);
                toastPubSub.pub({ type: "warning", text: u.failedReadFile });
                ev.target.value = "";
            });
            fileReader.readAsText(ev.target.files[0], "UTF-8");
        },
        [lrcDispatch, trimOptions, u.failedReadFile],
    );

    const onCopyClick = useCallback(() => {
        if (editorDraftError()) return;
        const el = textarea.current;
        el?.select();
        navigator.clipboard.writeText(exportText()).then(() => {
            toastPubSub.pub({ type: "success", text: u.copiedToClipboard });
        }).catch(() => {
            toastPubSub.pub({ type: "warning", text: u.copyFailed });
        });
    }, [u.copiedToClipboard, u.copyFailed, text]);

    const downloadName = useMemo(() => lrcFileName(lrcState.info), [lrcState.info]);
    const textareaValue = useDefaultValue(text, textarea);
    const parseRef = useRef(parse);
    parseRef.current = parse;
    useEffect(() => {
        if (!translation || bilingual || readOnly) return;
        const recovered = readEditorRecovery();
        if (recovered?.mode === "text" && textarea.current) textarea.current.value = recovered.texts[0];
        return registerEditorCommit(async () => {
            const input = textarea.current as HTMLTextAreaElement | null;
            if (input && readEditorRecovery()?.mode === "text") {
                await parseRef.current({ target: input } as React.FocusEvent<HTMLTextAreaElement>);
                if (readEditorRecovery()?.mode === "text") throw new Error(lang.ui.unsavedChanges);
            }
        });
    }, [Boolean(translation), bilingual, readOnly]);

    return (
        <div className={`app-editor${translation ? " has-translation" : ""}`}>
            <div className="editor-header-row">
                <details ref={details} open={detailsOpened} onToggle={onDetailsToggle}>
                    <summary aria-expanded={detailsOpened} aria-controls="editor-metadata-fields">{u.metadata}</summary>
                </details>
                <section
                    id="editor-metadata-fields"
                    className="app-editor-infobox"
                    hidden={!detailsOpened}
                    onChange={setInfo}
                >
                    <label htmlFor="info-ti">[ti:</label>
                    <input
                        id="info-ti"
                        name="ti"
                        placeholder={u.titleTrack}
                        readOnly={readOnly}
                        {...disableCheck}
                        {...useDefaultValue(lrcState.info.get("ti") || "")}
                    />
                    <label htmlFor="info-ti">]</label>
                    <label htmlFor="info-ar">[ar:</label>
                    <input
                        id="info-ar"
                        name="ar"
                        placeholder={u.artist}
                        readOnly={readOnly}
                        {...disableCheck}
                        {...useDefaultValue(lrcState.info.get("ar") || "")}
                    />
                    <label htmlFor="info-ar">]</label>
                    <label htmlFor="info-al">[al:</label>
                    <input
                        id="info-al"
                        name="al"
                        placeholder={u.album}
                        readOnly={readOnly}
                        {...disableCheck}
                        {...useDefaultValue(lrcState.info.get("al") || "")}
                    />
                    <label htmlFor="info-al">]</label>
                </section>

                <section className="editor-tools">
                    {translation && (
                        <button
                            type="button"
                            className="editor-tools-item ripple"
                            title={lang.translation.title}
                            aria-label={lang.translation.title}
                            aria-pressed={bilingual}
                            onClick={() => {
                                if (!editorDraftError()) setBilingual(value => !value);
                            }}
                        >
                            <TranslationSVG />
                        </button>
                    )}
                    <label
                        className={`editor-tools-item ripple${importing ? " importing" : ""}`}
                        title={u.importLyricsText}
                    >
                        <input
                            hidden={true}
                            type="file"
                            accept="text/*, .txt, .lrc"
                            onChange={onTextFileUpload}
                            disabled={readOnly || importing}
                        />
                        <OpenFileSVG />
                    </label>
                    <button className="editor-tools-item ripple" title={u.selectAllCopy} onClick={onCopyClick}>
                        <CopySVG />
                    </button>
                    <a
                        className="editor-tools-item ripple"
                        title={u.downloadLRC}
                        href={href}
                        onClick={onDownloadClick}
                        download={downloadName}
                    >
                        <DownloadSVG />
                    </a>
                    {onOpenUtils && !readOnly && (
                        <button
                            className="editor-tools-item ripple"
                            title={u.lrcUtilities}
                            type="button"
                            onClick={() => {
                                if (!editorDraftError()) onOpenUtils();
                            }}
                        >
                            <UtilitySVG />
                        </button>
                    )}
                </section>
            </div>

            {lrcState.parseUndo && !bilingual && (
                <button
                    className="ui-button"
                    type="button"
                    onClick={() => lrcDispatch({ type: LrcActionType.undoParse, payload: undefined })}
                >
                    {lang.translation.undo}
                </button>
            )}
            {bilingual && translation
                ? (
                    <TranslationEditor
                        state={lrcState}
                        dispatch={lrcDispatch}
                        controller={translation}
                        metadata={includeMetadataTags}
                    />
                )
                : (
                    <textarea
                        className="app-textarea"
                        aria-label={u.lrcInputHere}
                        readOnly={readOnly}
                        onBlur={parse}
                        onChange={event => {
                            if (translation) setEditorRecovery({ mode: "text", texts: [event.target.value] });
                        }}
                        {...disableCheck}
                        {...textareaValue}
                    />
                )}
        </div>
    );
};
