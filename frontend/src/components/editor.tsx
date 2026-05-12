import SSK from "#const/session_key.json" with { type: "json" };
import { type State as LrcState, stringify } from "@lrc-maker/lrc-parser";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Action as LrcAction } from "../hooks/useLrc.js";
import { ActionType as LrcActionType } from "../hooks/useLrc.js";
import { lrcFileName } from "../utils/lrc-file-name.js";
import { api } from "../shared/api.js";
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
}> = ({ lrcState, lrcDispatch }) => {
    const { prefState, trimOptions } = useContext(appContext);

    const parse = useCallback(
        (ev: React.FocusEvent<HTMLTextAreaElement>) => {
            lrcDispatch({
                type: LrcActionType.parse,
                payload: { text: ev.target.value, options: trimOptions },
            });
        },
        [lrcDispatch, trimOptions],
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

    const text = stringify(lrcState, prefState);

    const details = useRef<HTMLDetailsElement>(null);

    const onDetailsToggle = useCallback(() => {
        sessionStorage.setItem(SSK.editorDetailsOpen, details.current!.open.toString());
    }, []);

    const detailsOpened = useMemo(() => {
        return sessionStorage.getItem(SSK.editorDetailsOpen) !== "false";
    }, []);

    const textarea = useRef<HTMLInputLikeElement>(null);
    const [href, setHref] = useState<string | undefined>(undefined);
    const [cleanupRemoveTranslations, setCleanupRemoveTranslations] = useState(true);
    const [cleanupMessage, setCleanupMessage] = useState("");
    const [cleanupBusy, setCleanupBusy] = useState(false);

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

    const onCleanupClick = useCallback(async () => {
        const current = textarea.current?.value ?? text;
        setCleanupBusy(true);
        setCleanupMessage("Cleaning current LRC text...");
        try {
            const result = await api.cleanLrc({ text: current, remove_translations: cleanupRemoveTranslations });
            if (!result.cleaned_text) {
                setCleanupMessage(result.reason ? `Cleanup skipped: ${result.reason}` : "Cleanup skipped: no cleaned text returned.");
                return;
            }
            textarea.current!.value = result.cleaned_text;
            lrcDispatch({
                type: LrcActionType.parse,
                payload: { text: result.cleaned_text, options: trimOptions },
            });
            setCleanupMessage(result.status === "unchanged" ? "No cleanup changes were needed." : "Cleaned LRC applied to the editor.");
        } catch (error) {
            setCleanupMessage((error as Error).message);
        } finally {
            setCleanupBusy(false);
        }
    }, [cleanupRemoveTranslations, lrcDispatch, text, trimOptions]);

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

            <details className="editor-cleanup">
                <summary>LRC cleanup</summary>
                <label className="editor-cleanup-check">
                    <input
                        type="checkbox"
                        checked={cleanupRemoveTranslations}
                        onChange={(ev) => setCleanupRemoveTranslations(ev.currentTarget.checked)}
                    />
                    <span>Remove same-timestamp translated duplicate lines when detected</span>
                </label>
                <div className="editor-cleanup-actions">
                    <button type="button" disabled={cleanupBusy} onClick={onCleanupClick}>Apply cleanup</button>
                </div>
                {cleanupMessage && <small>{cleanupMessage}</small>}
            </details>

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
