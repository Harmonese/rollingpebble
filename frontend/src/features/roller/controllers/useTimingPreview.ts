import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { type Action, init, reducer } from "../../../domain/lyrics/useLyricsEngine.js";
import {
    type Draft,
    type DraftLine,
    getDraft,
    reviewLines,
    saveDraft,
    type TimingRun,
} from "../../../shared/api/timingV2.js";
import { appContext } from "../../../shared/appContext.js";

export function useTimingPreview(run: TimingRun | null) {
    const { trimOptions } = useContext(appContext);
    const [state, setState] = useState(() => init(() => ({ text: "", options: trimOptions, select: 0 })));
    const [edited, setEdited] = useState(false);
    const [loadedTask, setLoadedTask] = useState<string | null>(null);
    const loaded = Boolean(run && loadedTask === run.id);
    const [reload, setReload] = useState(0);
    const replacing = useRef(false);
    const [replacingState, setReplacing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const current = useRef(state);
    const draft = useRef<Draft>({ version: 0, base_revision: 0, lines: null });
    const record = useRef(run);
    record.current = run;
    const generation = useRef(0);
    const chain = useRef<Promise<void>>(Promise.resolve());
    const dirty = useRef(false);
    const loadedId = useRef<string | null>(null);
    const pendingCount = useRef(0);
    const lastAttempt = useRef<Draft | null>(null);
    const rowIds = useRef<string[]>([]);
    const publish = (next: typeof state) => {
        current.current = next;
        setState(next);
    };
    const hydrate = (lines: { text: string; time?: number | null }[]) => {
        const next = init(() => ({ text: "", options: trimOptions, select: 0 }));
        publish({
            ...next,
            lyric: lines.map(line => ({ text: line.text, ...(line.time == null ? {} : { time: line.time }) })),
        });
    };
    useEffect(() => {
        const token = ++generation.current;
        loadedId.current = null;
        chain.current = Promise.resolve();
        pendingCount.current = 0;
        lastAttempt.current = null;
        replacing.current = false;
        setReplacing(false);
        hydrate([]);
        setSaving(false);
        setLoadedTask(null);
        setError("");
        setEdited(false);
        dirty.current = false;
        if (!run) return;
        void getDraft(run.id).then(value => {
            if (token !== generation.current || record.current?.id !== run.id) return;
            draft.current = value;
            loadedId.current = run.id;
            dirty.current = value.lines !== null;
            setEdited(dirty.current);
            rowIds.current = value.lines?.map(line => line.id) || [];
            if (value.lines) hydrate(value.lines);
            setLoadedTask(run.id);
        }).catch(e => {
            if (token === generation.current && record.current?.id === run.id) setError(String(e));
        });
    }, [run?.id, reload]);
    useEffect(() => {
        if (!loaded || loadedId.current !== run?.id || dirty.current || replacing.current || !run?.snapshot) return;
        draft.current = { ...draft.current, base_revision: run.snapshot.revision };
        rowIds.current = reviewLines(run.snapshot).map(() => crypto.randomUUID());
        hydrate(reviewLines(run.snapshot));
    }, [loaded, loadedTask, edited, replacingState, run?.id, run?.snapshot?.revision]);

    const enqueue = (lines: DraftLine[] | null, revision: number) => {
        const id = record.current?.id;
        if (!id || loadedId.current !== id) return;
        const token = generation.current;
        pendingCount.current += 1;
        setSaving(true);
        chain.current = chain.current.then(async () => {
            if (token !== generation.current) return;
            lastAttempt.current = { version: draft.current.version, base_revision: revision, lines };
            const saved = await saveDraft(id, lastAttempt.current);
            if (token === generation.current) {
                draft.current = saved;
                setError("");
            }
        }).catch(e => {
            if (token === generation.current) setError(String(e));
            throw e;
        });
        const pending = chain.current;
        void pending.finally(() => {
            if (token === generation.current && --pendingCount.current === 0) setSaving(false);
        }).catch(() => {});
    };
    const dispatch = useCallback((action: Action) => {
        if (replacing.current || loadedId.current !== record.current?.id) return;
        const before = current.current;
        const next = reducer(before, action);
        publish(next);
        if (JSON.stringify(before.lyric) === JSON.stringify(next.lyric)) return;
        dirty.current = true;
        setEdited(true);
        // Engine occurrence IDs are revision-local. Draft rows have host-owned IDs.
        const ids = next.lyric.map((line, position) => {
            const index = before.lyric.indexOf(line);
            return index >= 0
                ? rowIds.current[index] || crypto.randomUUID()
                : before.lyric.length === next.lyric.length
                ? rowIds.current[position] || crypto.randomUUID()
                : crypto.randomUUID();
        });
        rowIds.current = ids;
        enqueue(
            next.lyric.map((line, index) => ({ id: ids[index], text: line.text, time: line.time ?? null })),
            draft.current.base_revision,
        );
    }, []);
    const useLatest = async (expectedId = record.current?.id) => {
        const token = generation.current;
        if (!expectedId || record.current?.id !== expectedId || loadedId.current !== expectedId || replacing.current) {
            return;
        }
        const valid = () => token === generation.current && record.current?.id === expectedId;
        replacing.current = true;
        setReplacing(true);
        try {
            await chain.current;
            if (!valid()) return;
            const snapshot = record.current?.snapshot;
            if (!snapshot) return;
            enqueue(null, snapshot.revision);
            await chain.current;
            if (!valid()) return;
            dirty.current = false;
            setEdited(false);
            rowIds.current = reviewLines(snapshot).map(() => crypto.randomUUID());
            hydrate(reviewLines(snapshot));
        } finally {
            if (valid()) {
                replacing.current = false;
                setReplacing(false);
            }
        }
    };
    const retrySave = async () => {
        const id = record.current?.id;
        if (!id) return;
        if (loadedId.current !== id) {
            setReload(value => value + 1);
            return;
        }
        const token = generation.current;
        try {
            const stored = await getDraft(id);
            if (record.current?.id !== id || token !== generation.current) return;
            const attempted = lastAttempt.current;
            // Recover a lost response only when the saved payload is ours.
            if (
                stored.version !== draft.current.version && (!attempted
                    || stored.version !== attempted.version + 1
                    || JSON.stringify(stored.lines) !== JSON.stringify(attempted.lines)
                    || stored.base_revision !== attempted.base_revision)
            ) throw new Error("Draft changed in another session");
            draft.current = { ...draft.current, version: stored.version };
            chain.current = Promise.resolve();
            enqueue(
                current.current.lyric.map((line, i) => ({
                    id: rowIds.current[i] || crypto.randomUUID(),
                    text: line.text,
                    time: line.time ?? null,
                })),
                draft.current.base_revision,
            );
        } catch (e) {
            if (record.current?.id === id && token === generation.current) setError(String(e));
        }
    };
    return {
        state,
        dispatch,
        edited,
        loaded: loaded && loadedId.current === run?.id,
        saving: saving || replacingState,
        error,
        useLatest,
        retrySave,
        flush: async () => {
            let pending;
            do {
                pending = chain.current;
                await pending;
            } while (pending !== chain.current);
        },
        version: () => draft.current.version,
        currentState: () => current.current,
    };
}
