import { useContext, useEffect, useRef, useState } from "react";
import {
    type LyricsDocumentAction,
    LyricsDocumentActionType as Action,
    type LyricsDocumentState,
} from "../../domain/lyrics/lyricsDocument.js";
import { hasTranslation, translationIdentity } from "../../domain/lyrics/translationDocument.js";
import { BackendApiError, backendMessageText } from "../../shared/api/request.js";
import {
    cancelTranslation,
    getTranslation,
    startTranslation,
    type TranslationInput,
    type TranslationJob,
} from "../../shared/api/translation.js";
import { appContext } from "../../shared/appContext.js";
import { editorDraftError } from "../../shared/editorDraft.js";
import { useConfirmDialog } from "../../ui/ConfirmDialog.js";

export function useTranslation(
    state: LyricsDocumentState,
    dispatch: React.Dispatch<LyricsDocumentAction>,
    workspaceId: string,
) {
    const { lang, prefState } = useContext(appContext);
    const confirm = useConfirmDialog();
    const [source, setSource] = useState(() => localStorage.getItem("translation.source") || "auto");
    const [target, setTarget] = useState(() => localStorage.getItem("translation.target") || prefState.lang || "en-US");
    useEffect(() => {
        if (state.targetLanguage) setTarget(state.targetLanguage);
    }, [workspaceId]);
    const [job, setJob] = useState<TranslationJob | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const live = useRef({ state, workspaceId, target, source });
    live.current = { state, workspaceId, target, source };
    const pending = useRef<{ input: TranslationInput; identity: string; valid: boolean } | null>(null);
    const mounted = useRef(true);
    const polling = useRef<string | null>(null);
    const identity = () =>
        JSON.stringify([
            live.current.workspaceId,
            live.current.source,
            live.current.target,
            translationIdentity(live.current.state.lyric, live.current.state.targetLanguage),
        ]);
    const observe = async (next: TranslationJob) => {
        if (polling.current === next.id) return;
        const observedId = next.id;
        polling.current = observedId;
        setError("");
        try {
            while (mounted.current && pending.current?.input.request_id === next.id) {
                setJob(next);
                if (!["running", "cancelling"].includes(next.status)) break;
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!mounted.current || pending.current?.input.request_id !== observedId) return;
                next = await getTranslation(next.id);
            }
            if (!mounted.current || pending.current?.input.request_id !== next.id) return;
            const captured = pending.current;
            if (next.status === "succeeded" && next.result && captured?.valid && captured.identity === identity()) {
                const draftError = editorDraftError();
                if (draftError) {
                    setError(draftError);
                    setBusy(false);
                    return;
                } else {dispatch({
                        type: Action.translate,
                        payload: { lines: next.result, target: captured.input.target_language },
                    });}
            }
            if (next.status === "failed") {
                setError(backendMessageText({ code: next.error || "translation.network" }, lang.backendMessages));
            }
            pending.current = null;
            lock.current = false;
            setBusy(false);
        } catch (e) {
            if (mounted.current && pending.current?.input.request_id === observedId) {
                setError(backendMessageText(e, lang.backendMessages));
            }
        } finally {
            if (polling.current === observedId) polling.current = null;
        }
    };
    const cancel = async () => {
        if (!pending.current) return;
        const captured = pending.current;
        captured.valid = false;
        try {
            const next = await cancelTranslation(captured.input.request_id);
            if (pending.current !== captured) return;
            if (mounted.current) {
                setJob(next);
                setBusy(false);
                setError("");
            }
            lock.current = false;
            pending.current = null;
        } catch (e) {
            if (mounted.current) setError(backendMessageText(e, lang.backendMessages));
        }
    };
    useEffect(() => {
        if (pending.current?.valid && pending.current.identity !== identity()) void cancel();
    }, [state.lyric, state.targetLanguage, workspaceId, target, source]);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            if (pending.current) void cancelTranslation(pending.current.input.request_id).catch(() => {});
        };
    }, []);
    const run = async (single = false) => {
        if (editorDraftError()) return;
        if (lock.current) return;
        lock.current = true;
        const captured = identity();
        const current = live.current.state;
        try {
            const chosen = current.lyric[current.selectIndex];
            if (!target.trim() || (single && !chosen?.text.trim())) return;
            if (single && current.targetLanguage && current.targetLanguage !== target) {
                setError(lang.translation.languageChanged);
                return;
            }
            const existing = single ? Boolean(chosen.translation) : hasTranslation(current.lyric);
            if (existing && await confirm({ message: lang.translation.overwrite }) !== "confirm") return;
            if (captured !== identity()) return;
            const id = crypto.randomUUID();
            const input: TranslationInput = {
                request_id: id,
                workspace_id: workspaceId,
                revision: id,
                source_language: source,
                target_language: target,
                lines: current.lyric.filter(line => line.text.trim()).map(line => ({ id: line.id!, text: line.text })),
                ...(single ? { selected_ids: [chosen.id!] } : {}),
                title: current.info.get("ti") || "",
                artist: current.info.get("ar") || "",
                album: current.info.get("al") || "",
            };
            if (!input.lines.length) return;
            pending.current = { input, identity: captured, valid: true };
            localStorage.setItem("translation.source", source);
            localStorage.setItem("translation.target", target);
            setBusy(true);
            setError("");
            setJob(null);
            await observe(await startTranslation(input));
        } catch (e) {
            setError(backendMessageText(e, lang.backendMessages));
            if (e instanceof BackendApiError && e.status >= 400 && e.status < 500) {
                pending.current = null;
                setBusy(false);
            }
        } finally {
            if (!pending.current) lock.current = false;
        }
    };
    const retry = async () => {
        const captured = pending.current;
        if (!captured) {
            setError("");
            return;
        }
        if (!captured.valid) {
            await cancel();
            return;
        }
        try {
            // Idempotent POST recovers both a lost creation response and a query failure.
            await observe(await startTranslation(captured.input));
        } catch (e) {
            setError(backendMessageText(e, lang.backendMessages));
        }
    };
    return { source, target, setSource, setTarget, busy, job, error, run, cancel, retry };
}
export type TranslationController = ReturnType<typeof useTranslation>;
