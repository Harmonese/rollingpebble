import SSK from "#const/session_key.json" with { type: "json" };
import { type State as LrcState, stringify } from "@lrc-maker/lrc-parser";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Action as LrcAction } from "../hooks/useLrc.js";
import { ActionType as LrcActionType } from "../hooks/useLrc.js";
import { lrcFileName } from "../utils/lrc-file-name.js";
import { appContext } from "./app.context.js";
import { CopySVG, DownloadSVG, OpenFileSVG, UtilitySVG } from "./svg.js";
import { toastPubSub } from "./toast.js";

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

export const Editor: React.FC<{
    lrcState: LrcState;
    lrcDispatch: React.Dispatch<LrcAction>;
    includeMetadataTags?: boolean;
    onOpenUtils?: () => void;
}> = ({ lrcState, lrcDispatch, includeMetadataTags = true, onOpenUtils }) => {
    const { prefState, trimOptions, lang } = useContext(appContext);
    const u = lang?.ui || {} as Record<string, string>;

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

    useEffect(() => {
        const onBeforeUnload = () => { (document.activeElement as HTMLElement)?.blur(); };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, []);

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

    const [importing, setImporting] = useState(false);

    const onTextFileUpload = useCallback(
        (ev: React.ChangeEvent<HTMLInputElement>) => {
            if (ev.target.files === null || ev.target.files.length === 0) {
                return;
            }

            setImporting(true);
            const fileReader = new FileReader();
            fileReader.addEventListener("load", () => {
                lrcDispatch({
                    type: LrcActionType.parse,
                    payload: { text: fileReader.result as string, options: trimOptions },
                });
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
        const el = textarea.current;
        if (!el) return;
        el.select();
        navigator.clipboard.writeText(el.value).then(() => {
            toastPubSub.pub({ type: "success", text: u.copiedToClipboard });
        }).catch(() => {
            toastPubSub.pub({ type: "warning", text: u.copyFailed });
        });
    }, [u.copiedToClipboard, u.copyFailed]);

    const downloadName = useMemo(() => lrcFileName(lrcState.info), [lrcState.info]);

    return (
        <div className="app-editor">
            <div className="editor-header-row">
                <details ref={details} open={detailsOpened} onToggle={onDetailsToggle}>
                        <summary>{u.metadata}</summary>
                        <section className="app-editor-infobox" onBlur={setInfo}>
                            <label htmlFor="info-ti">[ti:</label>
                            <input
                                id="info-ti"
                                name="ti"
                                placeholder={u.titleTrack}
                                {...disableCheck}
                                {...useDefaultValue(lrcState.info.get("ti") || "")}
                            />
                            <label htmlFor="info-ti">]</label>
                            <label htmlFor="info-ar">[ar:</label>
                            <input
                                id="info-ar"
                                name="ar"
                                placeholder={u.artist}
                                {...disableCheck}
                                {...useDefaultValue(lrcState.info.get("ar") || "")}
                            />
                            <label htmlFor="info-ar">]</label>
                            <label htmlFor="info-al">[al:</label>
                            <input
                                id="info-al"
                                name="al"
                                placeholder={u.album}
                                {...disableCheck}
                                {...useDefaultValue(lrcState.info.get("al") || "")}
                            />
                            <label htmlFor="info-al">]</label>
                        </section>
                    </details>

                <section className="editor-tools">
                    <label className={`editor-tools-item ripple${importing ? " importing" : ""}`} title={u.importLyricsText}>
                        <input hidden={true} type="file" accept="text/*, .txt, .lrc" onChange={onTextFileUpload} disabled={importing} />
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
                    {onOpenUtils && (
                        <button className="editor-tools-item ripple" title={u.lrcUtilities} type="button" onClick={onOpenUtils}>
                            <UtilitySVG />
                        </button>
                    )}
                </section>
            </div>

            <textarea
                className="app-textarea"
                aria-label={u.lrcInputHere}
                onBlur={parse}
                {...disableCheck}
                {...useDefaultValue(text, textarea)}
            />
        </div>
    );
};
