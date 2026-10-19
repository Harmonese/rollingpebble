import { useContext, useEffect, useRef, useState } from "react";
import { useAutoTimingState } from "../../domain/auto-timing/useAutoTimingState.js";
import { useSettingsUpdated } from "../../hooks/useSettingsUpdated.js";
import { listProjects } from "../../shared/api/projects.js";
import { BackendApiError, backendMessageText } from "../../shared/api/request.js";
import { waitForRuntime } from "../../shared/api/runtimePreparation.js";
import { settings } from "../../shared/api/settings.js";
import {
    cancelTiming,
    deleteTiming,
    getBatch,
    getTiming,
    isRunActive,
    resumeBatch,
    retryBatch,
    startBatch,
    startTiming,
    TIMING_DELETED_EVENT,
    type TimingBatch,
    timingDiagnostics,
    timingHistory,
    type TimingRun,
} from "../../shared/api/timingV2.js";
import type { ProjectModel } from "../../shared/api/types.js";
import { appContext } from "../../shared/appContext.js";
import { useConfirmDialog } from "../../ui/ConfirmDialog.js";
import { Button, ButtonGroup, Panel, StatusPill, Tabs } from "../../ui/index.js";
import { AutoTimingFields } from "./AutoTimingFields.js";
import { BatchProjectPicker } from "./parts/BatchProjectPicker.js";
import { TimingProgress } from "./parts/TimingProgress.js";
import { TimingResultRow } from "./parts/TimingResultRow.js";

export const RollerPanel: React.FC<{
    project: ProjectModel | null;
    saveWorkspace: () => Promise<ProjectModel>;
    workspaceId: string;
    workspaceSignature: string;
    workspaceBusy: boolean;
    canStart: boolean;
    onRun: (run: TimingRun) => void;
    onOpen: (run: TimingRun) => Promise<void>;
    onDelete: (id: string) => void;
}> = (props) => {
    const { lang } = useContext(appContext);
    const t = lang.timingV2;
    const confirm = useConfirmDialog();
    const at = useAutoTimingState();
    const [mode, setMode] = useState<"single" | "batch">("single");
    const [run, setRun] = useState<TimingRun | null>(null);
    const [batch, setBatch] = useState<TimingBatch | null>(null);
    const [history, setHistory] = useState<TimingRun[]>([]);
    const [projects, setProjects] = useState<ProjectModel[]>([]);
    const [selected, setSelected] = useState(new Set<string>());
    const [busy, setBusy] = useState(false);
    const [preparing, setPreparing] = useState(false);
    const [prepareFailed, setPrepareFailed] = useState(false);
    const [repairNeeded, setRepairNeeded] = useState(true);
    const intent = useRef(0);
    const actionLock = useRef(false);
    const identity = JSON.stringify([
        props.workspaceId,
        props.workspaceSignature,
        props.project?.audio_ref,
        props.workspaceBusy,
        mode,
        [...selected],
        at.options,
    ]);
    const latestIdentity = useRef(identity);
    latestIdentity.current = identity;
    useEffect(() => () => {
        intent.current++;
    }, []);
    const prepare = async (repair = false, vocals = at.options.audio_mode === "vocals") => {
        const token = ++intent.current;
        const expected = latestIdentity.current;
        setPreparing(true);
        setPrepareFailed(false);
        try {
            return await waitForRuntime(
                vocals,
                () => intent.current === token && latestIdentity.current === expected,
                repair,
            );
        } catch (error) {
            setError(backendMessageText(error, lang.backendMessages));
            setPrepareFailed(true);
            setRepairNeeded(!(error instanceof BackendApiError && error.status === 409));
            return false;
        } finally {
            setPreparing(false);
        }
    };
    const [error, setError] = useState("");
    const [diagnostics, setDiagnostics] = useState("");
    const [clock, setClock] = useState(Date.now());
    useEffect(() => {
        const deleted = (event: Event) => {
            const id = (event as CustomEvent<string>).detail;
            setHistory(rows => rows.filter(row => row.id !== id));
            setRun(value => value?.id === id ? null : value);
            setBatch(value =>
                value
                    ? {
                        ...value,
                        runs: value.runs?.filter(row => row.id !== id),
                        children: value.children.filter(child => child !== id),
                    }
                    : value
            );
        };
        window.addEventListener(TIMING_DELETED_EVENT, deleted);
        return () => window.removeEventListener(TIMING_DELETED_EVENT, deleted);
    }, []);
    const active = isRunActive(run) || isRunActive(batch);
    useSettingsUpdated(async () => {
        at.loadFromSettings(await settings());
    }, true);
    useEffect(() => {
        let stale = false;
        void Promise.all([timingHistory(), listProjects()]).then(([rows, available]) => {
            if (!stale) {
                setHistory(rows);
                setProjects(available);
            }
        }).catch(e => setError(backendMessageText(e, lang.backendMessages)));
        return () => {
            stale = true;
        };
    }, [props.project?.project_id, run?.status, batch?.status]);
    useEffect(() => {
        if (!active) return;
        const timer = window.setInterval(() => setClock(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [active]);
    useEffect(() => {
        if (!active) return;
        let stopped = false;
        const poll = async () => {
            try {
                if (isRunActive(batch) && batch) {
                    const next = await getBatch(batch.id);
                    if (!stopped) setBatch(next);
                } else if (run) {
                    const next = await getTiming(run.id);
                    if (!stopped) {
                        setRun(next);
                        props.onRun(next);
                    }
                }
            } catch (e) {
                if (!stopped) setError(backendMessageText(e, lang.backendMessages));
            }
            if (!stopped) timer = window.setTimeout(poll, 1000);
        };
        let timer = window.setTimeout(poll, 1000);
        return () => {
            stopped = true;
            window.clearTimeout(timer);
        };
    }, [run?.id, batch?.id, active]);
    const act = async (action: () => Promise<void>) => {
        if (actionLock.current) return;
        actionLock.current = true;
        setBusy(true);
        setError("");
        try {
            await action();
        } catch (e) {
            setError(backendMessageText(e, lang.backendMessages));
        } finally {
            actionLock.current = false;
            setBusy(false);
        }
    };
    return (
        <Panel
            title={
                <>
                    {lang.ui.autoTiming} <StatusPill>Experimental</StatusPill> <StatusPill>English</StatusPill>
                </>
            }
        >
            <Tabs
                ariaLabel={lang.ui.autoTiming}
                value={mode}
                onChange={next => {
                    setMode(next);
                    if (next === "batch") void act(async () => setProjects(await listProjects()));
                }}
                items={[{ value: "single", label: lang.ui.single }, { value: "batch", label: lang.ui.batch }]}
            />
            {mode === "batch" && (
                <BatchProjectPicker
                    projects={projects}
                    selectedIds={selected}
                    labels={lang.ui}
                    onToggle={id =>
                        setSelected(old => {
                            const next = new Set(old);
                            if (next.has(id)) next.delete(id);
                            else next.add(id);
                            return next;
                        })}
                    onSelectAll={() => setSelected(new Set(projects.map(p => p.project_id)))}
                    onDeselectAll={() => setSelected(new Set())}
                />
            )}
            <AutoTimingFields at={at} />
            {mode === "single" && run && <TimingProgress run={run} lang={lang} clock={clock} />}
            {mode === "batch" && batch && (
                <TimingProgress run={batch.runs?.find(isRunActive) || batch} lang={lang} clock={clock} />
            )}
            <ButtonGroup className="studio-run-actions">
                <Button
                    tone="primary"
                    disabled={busy || active || props.workspaceBusy
                        || (mode === "single" ? !props.canStart : !selected.size)}
                    onClick={() =>
                        void act(async () => {
                            if (!await prepare()) return;
                            if (mode === "batch") {
                                setBatch(await startBatch([...selected], at.options));
                                return;
                            }
                            const saved = await props.saveWorkspace();
                            const next = await startTiming({
                                project_id: saved.project_id,
                                options: at.options,
                                expected_lyrics: saved.plain_lyrics,
                                expected_audio_ref: saved.audio_ref || undefined,
                                workspace_id: props.workspaceId,
                                lyrics_version: props.workspaceSignature,
                            });
                            setRun(next);
                            props.onRun(next);
                        })}
                >
                    {mode === "single" && run && !active ? t.retry : t.start}
                </Button>
                <Button
                    tone="danger"
                    disabled={preparing ? false : !active || busy}
                    onClick={() => {
                        if (preparing) {
                            intent.current++;
                            return;
                        }
                        void act(async () => {
                            if (isRunActive(batch) && batch) setBatch(await cancelTiming(batch.id) as TimingBatch);
                            else if (run) {
                                const next = await cancelTiming(run.id);
                                setRun(next);
                                props.onRun(next);
                            }
                        });
                    }}
                >
                    {t.cancel}
                </Button>
                {batch && !isRunActive(batch) && batch.runs?.some(item => item.status === "failed") && (
                    <Button
                        disabled={busy || active}
                        onClick={() =>
                            void act(async () => {
                                if (await prepare(false, batch.options.audio_mode === "vocals")) {
                                    setBatch(await retryBatch(batch.id));
                                }
                            })}
                    >
                        {t.retryFailed}
                    </Button>
                )}
                {batch && !isRunActive(batch)
                    && batch.runs?.some(item => ["cancelled", "interrupted"].includes(item.status)) && (
                    <Button
                        disabled={busy || active}
                        onClick={() =>
                            void act(async () => {
                                if (await prepare(false, batch.options.audio_mode === "vocals")) {
                                    setBatch(await resumeBatch(batch.id));
                                }
                            })}
                    >
                        {t.resume}
                    </Button>
                )}
            </ButtonGroup>
            {preparing && <p role="status">{t.preparing}</p>}
            {prepareFailed && (
                <div className="ui-action-row">
                    <Button
                        disabled={busy}
                        onClick={() =>
                            void act(async () => {
                                await prepare(repairNeeded);
                            })}
                    >
                        {repairNeeded ? t.repair : t.retry}
                    </Button>
                </div>
            )}
            {mode === "batch"
                && batch?.runs?.map(item => (
                    <TimingResultRow
                        key={item.id}
                        run={item}
                        lang={lang}
                        title={projects.find(p => p.project_id === item.project_id)?.metadata.track || item.project_id}
                        busy={busy}
                        onOpen={() => void act(async () => props.onOpen(await getTiming(item.id)))}
                    />
                ))}
            {error && <p role="alert">{error}</p>}
            <details>
                <summary>{t.history}</summary>
                {history.filter(item =>
                    item.kind === "batch" || !props.project || item.project_id === props.project.project_id
                ).map(item => (
                    <TimingResultRow
                        key={item.id}
                        run={item}
                        lang={lang}
                        title={item.kind === "batch"
                            ? lang.ui.batch
                            : (props.project?.project_id === item.project_id
                                ? props.project.metadata.track
                                : projects.find(p => p.project_id === item.project_id)?.metadata.track)
                                || item.project_id}
                        busy={busy}
                        deleteDisabled={busy || active || isRunActive(item)}
                        onOpen={() =>
                            void act(async () => {
                                if (item.kind === "batch") {
                                    setBatch(await getBatch(item.id));
                                    setMode("batch");
                                    setProjects(await listProjects());
                                    return;
                                }
                                const next = await getTiming(item.id);
                                await props.onOpen(next);
                                if (!isRunActive(run) || run?.id === next.id) setRun(next);
                            })}
                        onDelete={item.kind === "run"
                            ? () =>
                                void act(async () => {
                                    if (
                                        await confirm({ message: t.removeResult, danger: true }) !== "confirm"
                                    ) return;
                                    await deleteTiming(item.id);
                                    props.onDelete(item.id);
                                    if (run?.id === item.id) setRun(null);
                                    setHistory(rows => rows.filter(row => row.id !== item.id));
                                })
                            : undefined}
                    />
                ))}
            </details>
            {run && (
                <details
                    onToggle={e => {
                        if (e.currentTarget.open) {
                            void act(async () => setDiagnostics((await timingDiagnostics(run.id)).stderr));
                        }
                    }}
                >
                    <summary>{t.diagnostics}</summary>
                    <pre>{run.command?.join(" ")}{"\n"}{run.error}{"\n"}{JSON.stringify(run.metrics, null, 2)}{"\n"}{diagnostics}</pre>
                </details>
            )}
        </Panel>
    );
};
