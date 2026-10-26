import { useContext, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
    type LyricsDocumentAction,
    LyricsDocumentActionType as Action,
    lyricsDocumentExport,
    type LyricsDocumentState,
} from "../../domain/lyrics/lyricsDocument.js";
import { lrcFileName } from "../../domain/lyrics/lyricsFileName.js";
import { openTranslationSettings } from "../../shared/api/translation.js";
import { appContext } from "../../shared/appContext.js";
import {
    editorDraftError,
    readEditorRecovery,
    registerEditorDraft,
    setEditorRecovery,
} from "../../shared/editorDraft.js";
import { CopySVG, DownloadSVG, PreferencesSVG } from "../../ui/icons.js";
import { Button, ButtonGroup, Input, MessageText, Select, TaskStatus } from "../../ui/index.js";
import { PairedEditors } from "./PairedEditors.js";
import type { TranslationController } from "./useTranslation.js";
import "./translation.css";

const languages = ["en", "en-US", "zh-CN", "zh-TW", "zh-HK", "ja", "ko", "fr", "de", "es", "pt", "ru"];
function LanguageField({ label, value, change, auto, locale, automatic, other }: {
    label: string;
    value: string;
    change: (value: string) => void;
    auto?: boolean;
    locale: string;
    automatic: string;
    other: string;
}) {
    const [custom, setCustom] = useState(!languages.includes(value) && !(auto && value === "auto"));
    const names = new Intl.DisplayNames([locale], { type: "language" });
    const known = languages.includes(value) || (auto && value === "auto");
    return (
        <label className="translation-language">
            <span>{label}</span>
            <Select
                value={custom || !known ? "other" : value}
                onChange={event => {
                    setCustom(event.target.value === "other");
                    if (event.target.value !== "other") change(event.target.value);
                }}
            >
                {auto && <option value="auto">{automatic}</option>}
                {languages.map(code => <option key={code} value={code}>{names.of(code) || code}</option>)}
                <option value="other">{other}</option>
            </Select>
            {(custom || !known) && (
                <Input
                    aria-label={label}
                    value={value}
                    onChange={event => change(event.target.value)}
                />
            )}
        </label>
    );
}

export function TranslationEditor({ state, dispatch, controller: c, metadata = true }: {
    state: LyricsDocumentState;
    dispatch: React.Dispatch<LyricsDocumentAction>;
    controller: TranslationController;
    metadata?: boolean;
}) {
    const { lang, prefState } = useContext(appContext);
    const t = lang.translation;
    const left = useRef<HTMLDivElement>(null), right = useRef<HTMLDivElement>(null);
    const editors = useRef<PairedEditors | null>(null);
    const [editError, setEditError] = useState<"structure" | "timestamp" | null>(null);
    const [copyError, setCopyError] = useState(false);
    const live = useRef({ state, dispatch, c, t });
    live.current = { state, dispatch, c, t };
    const options = () => ({
        lines: live.current.state.lyric,
        target: live.current.state.targetLanguage || "",
        editTarget: live.current.c.target,
        fixed: prefState.fixed,
        stale: live.current.t.stale,
        labels: [live.current.t.original, live.current.t.translation] as [string, string],
        commit: (lines: import("../../domain/lyrics/translationDocument.js").TranslatedLine[], target: string) => {
            flushSync(() => live.current.dispatch({ type: Action.editPair, payload: { lines, target } }));
        },
        select: (index: number) => live.current.dispatch({ type: Action.select, payload: () => index }),
        error: setEditError,
        draft: (texts: string[] | null) => setEditorRecovery(texts ? { mode: "paired", texts } : null),
    });
    useLayoutEffect(() => {
        const instance = new PairedEditors([left.current!, right.current!], options());
        editors.current = instance;
        const recovered = readEditorRecovery();
        if (recovered?.mode === "paired") {
            instance.views.forEach((view, side) => {
                const value = recovered.texts[side];
                if (value !== undefined) {
                    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
                }
            });
        }
        const unregister = registerEditorDraft(() => instance.validate(false) ? null : live.current.t.invalidTimestamp);
        return () => {
            unregister();
            instance.destroy();
            editors.current = null;
        };
    }, []);
    useLayoutEffect(() => {
        editors.current?.update(options());
    }, [state.lyric, state.targetLanguage, c.target, prefState.fixed, t.stale]);
    const exportText = (mode: "original" | "translation", download: boolean) => {
        if (editorDraftError()) return;
        const value = lyricsDocumentExport(live.current.state, mode, prefState, metadata);
        if (!download) {
            void navigator.clipboard.writeText(value).then(() => setCopyError(false)).catch(() => setCopyError(true));
            return;
        }
        const url = URL.createObjectURL(new Blob([value], { type: "text/plain;charset=UTF-8" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = lrcFileName(live.current.state.info).replace(/\.lrc$/i, `.${mode}.lrc`);
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return (
        <div className="translation-editor">
            <div className="translation-controls">
                <div className="translation-languages">
                    <LanguageField
                        label={t.source}
                        value={c.source}
                        change={value => {
                            if (!editorDraftError()) c.setSource(value);
                        }}
                        auto
                        locale={prefState.lang}
                        automatic={t.automatic}
                        other={t.otherLanguage}
                    />
                    <LanguageField
                        label={t.target}
                        value={c.target}
                        change={value => {
                            if (!editorDraftError()) c.setTarget(value);
                        }}
                        locale={prefState.lang}
                        automatic={t.automatic}
                        other={t.otherLanguage}
                    />
                </div>
                <ButtonGroup compact className="translation-run-actions">
                    <Button
                        tone="primary"
                        disabled={c.busy || !state.lyric.some(line => line.text.trim()) || !c.target.trim()
                            || c.target === "auto"}
                        onClick={() => {
                            if (!editorDraftError()) void c.run();
                        }}
                    >
                        {t.translate}
                    </Button>
                    <Button
                        disabled={c.busy || !state.lyric[state.selectIndex]?.text.trim()}
                        onClick={() => {
                            if (!editorDraftError()) void c.run(true);
                        }}
                    >
                        {t.retranslate}
                    </Button>
                    <button
                        type="button"
                        className="editor-tools-item ripple"
                        aria-label={lang.ui.settings}
                        title={lang.ui.settings}
                        onClick={() => {
                            if (!editorDraftError()) openTranslationSettings();
                        }}
                    >
                        <PreferencesSVG />
                    </button>
                </ButtonGroup>
            </div>
            {editError && (
                <MessageText type="error">
                    {editError === "structure" ? t.structureEdit : t.invalidTimestamp}
                </MessageText>
            )}
            {copyError && <MessageText type="error">{lang.ui.copyFailed}</MessageText>}
            {(c.busy || c.error) && (
                <TaskStatus
                    title={c.busy
                        ? c.job?.status === "cancelling" ? t.cancelling : t.translating
                        : lang.modelSetup.operationFailed}
                    active={c.busy}
                    error={c.error}
                >
                    {c.busy
                        ? (
                            <Button disabled={c.job?.status === "cancelling"} onClick={() => void c.cancel()}>
                                {lang.ui.cancel}
                            </Button>
                        )
                        : <Button onClick={() => void c.retry()}>{t.retry}</Button>}
                </TaskStatus>
            )}
            <div className="translation-columns">
                {(["original", "translation"] as const).map((mode, i) => (
                    <section className="translation-column" key={mode}>
                        <div className="translation-column-header">
                            <span>{t[mode]}{i === 1 && state.targetLanguage ? ` · ${state.targetLanguage}` : ""}</span>
                            <div className="translation-column-actions">
                                <button
                                    type="button"
                                    className="editor-tools-item ripple"
                                    aria-label={`${t[mode]} · ${lang.ui.selectAllCopy}`}
                                    title={lang.ui.selectAllCopy}
                                    onClick={() =>
                                        exportText(mode, false)}
                                >
                                    <CopySVG />
                                </button>
                                <button
                                    type="button"
                                    className="editor-tools-item ripple"
                                    aria-label={`${t[mode]} · ${lang.ui.downloadLRC}`}
                                    title={lang.ui.downloadLRC}
                                    onClick={() =>
                                        exportText(mode, true)}
                                >
                                    <DownloadSVG />
                                </button>
                            </div>
                        </div>
                        <div className="translation-text" ref={i === 0 ? left : right} />
                    </section>
                ))}
            </div>
        </div>
    );
}
