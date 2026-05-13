import SSK from "#const/session_key.json" with { type: "json" };
import { type State as LrcState, stringify } from "@lrc-maker/lrc-parser";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Action as LrcAction } from "../hooks/useLrc.js";
import { ActionType as LrcActionType } from "../hooks/useLrc.js";
import { lrcFileName } from "../utils/lrc-file-name.js";
import { api } from "../shared/api.js";
import { EDITOR_LRC_CLEANUP_REQUEST_EVENT, type EditorLrcCleanupRequest } from "../shared/editorCleanupEvents.js";
import { appContext } from "./app.context.js";
import { CopySVG, DownloadSVG, OpenFileSVG } from "./svg.js";

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
            $ref.current.value = defaultValue;
        }
    }, [defaultValue, $ref]);
    return { ref: $ref, defaultValue };
};

export const Eidtor: React.FC<{
    lrcState: LrcState;
    lrcDispatch: React.Dispatch<LrcAction>;
    includeMetadataTags?: boolean;
}> = ({ lrcState, lrcDispatch, includeMetadataTags = true }) => {
    const { prefState, trimOptions } = useContext(appContext);

    const metadataHeader = useCallback((): string => {
        return Array.from(lrcState.info.entries())
            .map(([name, value]) => `[${name}:${value}]`)
            .join("\n");
    }, [lrcState.info]);

    const parse = useCallback(
        (ev: React.FocusEvent<HTMLTextAreaElement>) => {
            const body = ev.target.value;
            const text = includeMetadataTags ? body : [metadataHeader(), body].filter(Boolean).join("\n");
            lrcDispatch({
                type: LrcActionType.parse,
                payload: { text, options: trimOptions },
            });
        },
        [includeMetadataTags, lrcDispatch, metadataHeader, trimOptions],
    );

    const setInfo = useCallback(
        (ev: React.FocusEvent<HTMLInputElement>) => {
            const { name, value } = ev.target;
            lrcDispatch({
                type: LrcActionType.info,
                payload: { name, value },
            });
        },
        [lrcDispatch],
    );

    const text = includeMetadataTags ? stringify(lrcState, prefState) : stringify({ ...lrcState, info: new Map() } as LrcState, prefState);

    const details = useRef<HTMLDetailsElement>(null);

    const onDetailsToggle = useCallback(() => {
        sessionStorage.setItem(SSK.editorDetailsOpen, details.current!.open.toString());
    }, []);

    const detailsOpened = useMemo(() => {
        return sessionStorage.getItem(SSK.editorDetailsOpen) !== "false";
    }, []);

    const textarea = useRef<HTMLInputLikeElement>(null);
    const [href, setHref] = useState<string | undefined>(undefined);

    const onDownloadClick = useCallback(() => {
        setHref((url) => {
            if (url) {
                URL.revokeObjectURL(url);
            }

            return URL.createObjectURL(
                new Blob([textarea.current!.value], {
                    type: "text/plain;charset=UTF-8",
                }),
            );
        });
    }, []);

    const onTextFileUpload = useCallback(
        (ev: React.ChangeEvent<HTMLInputElement>) => {
            if (ev.target.files === null || ev.target.files.length === 0) {
                return;
            }

            const fileReader = new FileReader();
            fileReader.addEventListener("load", () => {
                lrcDispatch({
                    type: LrcActionType.parse,
                    payload: { text: fileReader.result as string, options: trimOptions },
                });
            });
            fileReader.readAsText(ev.target.files[0], "UTF-8");
        },
        [lrcDispatch, trimOptions],
    );

    const onCopyClick = useCallback(() => {
        textarea.current?.select();
        document.execCommand("copy");
    }, []);

    useEffect(() => {
        const onCleanupRequest = (event: Event) => {
            const detail = (event as CustomEvent<EditorLrcCleanupRequest>).detail;
            const current = textarea.current?.value ?? text;
            if (!textarea.current) {
                detail?.onResult?.({ ok: false, message: "Editor is not ready." });
                return;
            }
            api.cleanLrc({ text: current, remove_translations: detail?.removeTranslations ?? true })
                .then((result) => {
                    if (!result.cleaned_text) {
                        detail?.onResult?.({
                            ok: false,
                            message: result.reason ? `Cleanup skipped: ${result.reason}` : "Cleanup skipped: no cleaned text returned.",
                        });
                        return;
                    }
                    textarea.current!.value = result.cleaned_text;
                    const parsedText = includeMetadataTags ? result.cleaned_text : [metadataHeader(), result.cleaned_text].filter(Boolean).join("\n");
                    lrcDispatch({
                        type: LrcActionType.parse,
                        payload: { text: parsedText, options: trimOptions },
                    });
                    detail?.onResult?.({
                        ok: true,
                        message: result.status === "unchanged" ? "No cleanup changes were needed." : "Cleaned LRC applied to the editor.",
                    });
                })
                .catch((error: Error) => detail?.onResult?.({ ok: false, message: error.message }));
        };
        window.addEventListener(EDITOR_LRC_CLEANUP_REQUEST_EVENT, onCleanupRequest);
        return () => window.removeEventListener(EDITOR_LRC_CLEANUP_REQUEST_EVENT, onCleanupRequest);
    }, [includeMetadataTags, lrcDispatch, metadataHeader, text, trimOptions]);

    const downloadName = useMemo(() => lrcFileName(lrcState.info), [lrcState.info]);

    return (
        <div className="app-editor">
            <div className="editor-header-row">
                <details ref={details} open={detailsOpened} onToggle={onDetailsToggle}>
                        <summary>Metadata</summary>
                        <section className="app-editor-infobox" onBlur={setInfo}>
                            <label htmlFor="info-ti">[ti:</label>
                            <input
                                id="info-ti"
                                name="ti"
                                placeholder="Title"
                                {...disableCheck}
                                {...useDefaultValue(lrcState.info.get("ti") || "")}
                            />
                            <label htmlFor="info-ti">]</label>
                            <label htmlFor="info-ar">[ar:</label>
                            <input
                                id="info-ar"
                                name="ar"
                                placeholder="Artist"
                                {...disableCheck}
                                {...useDefaultValue(lrcState.info.get("ar") || "")}
                            />
                            <label htmlFor="info-ar">]</label>
                            <label htmlFor="info-al">[al:</label>
                            <input
                                id="info-al"
                                name="al"
                                placeholder="Album"
                                {...disableCheck}
                                {...useDefaultValue(lrcState.info.get("al") || "")}
                            />
                            <label htmlFor="info-al">]</label>
                        </section>
                    </details>

                <section className="editor-tools">
                    <label className="editor-tools-item ripple" title="Import lyrics text">
                        <input hidden={true} type="file" accept="text/*, .txt, .lrc" onChange={onTextFileUpload} />
                        <OpenFileSVG />
                    </label>
                    <button className="editor-tools-item ripple" title="Select all and copy" onClick={onCopyClick}>
                        <CopySVG />
                    </button>
                    <a
                        className="editor-tools-item ripple"
                        title="Download LRC"
                        href={href}
                        onClick={onDownloadClick}
                        download={downloadName}
                    >
                        <DownloadSVG />
                    </a>
                </section>
            </div>

            <textarea
                className="app-textarea"
                aria-label="lrc input here"
                onBlur={parse}
                {...disableCheck}
                {...useDefaultValue(text, textarea)}
            />
        </div>
    );
};
