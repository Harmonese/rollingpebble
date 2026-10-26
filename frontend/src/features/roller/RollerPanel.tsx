import { useContext, useEffect, useRef, useState } from "react";
import { useAutoTimingState } from "../../domain/auto-timing/useAutoTimingState.js";
import { useSettingsUpdated } from "../../hooks/useSettingsUpdated.js";
import { modelName } from "../../shared/api/models.js";
import { listProjects } from "../../shared/api/projects.js";
import { BackendApiError, backendMessageText } from "../../shared/api/request.js";
import { type Preparation, waitForRuntime } from "../../shared/api/runtimePreparation.js";
import { settings } from "../../shared/api/settings.js";
import {
    cancelTiming,
    deleteTiming,
    getBatch,
    getTiming,
    isRunActive,
    rememberTimingLanguage,
    resumeBatch,
    retryBatch,
    retryTiming,
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
import { PROJECTS_CHANGED_EVENT } from "../../shared/projectEvents.js";
import { useConfirmDialog } from "../../ui/ConfirmDialog.js";
import { Button, ButtonGroup, CommandBlock, LogBlock, MessageText, Panel, StatusPill, Tabs } from "../../ui/index.js";
import { AutoTimingFields } from "./AutoTimingFields.js";
import { BatchProjectPicker } from "./parts/BatchProjectPicker.js";
import { TimingProgress, TimingStartupProgress } from "./parts/TimingProgress.js";
import { TimingResultRow } from "./parts/TimingResultRow.js";
import { canRetryTiming, timingOptionsEqual } from "./retryEligibility.js";

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
    const [startup, setStartup] = useState<
        { stage: "checking" | "preparing" | "submitting"; startedAt: number } | null
    >(null);
    const [preparing, setPreparing] = useState(false);
    const [prepareFailed, setPrepareFailed] = useState(false);
    const [repairNeeded, setRepairNeeded] = useState(true);
    const intent = useRef(0);
    const actionLock = useRef(false);
    const languageSaves = useRef<Promise<unknown>>(Promise.resolve());
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
        setClock(Date.now());
        setStartup({ stage: "checking", startedAt: Date.now() });
        setPrepareFailed(false);
        try {
            const ready = await waitForRuntime(
                vocals,
                () => intent.current === token && latestIdentity.current === expected,
                repair,
                (state: Preparation) => {
                    if (intent.current === token && latestIdentity.current === expected) {
                        setStartup(value =>
                            value ? { ...value, stage: state.status === "preparing" ? "preparing" : "checking" } : value
                        );
                    }
                },
                at.options.language === "mul",
            );
            if (!ready) setStartup(null);
            return ready;
        } catch (error) {
            setError(backendMessageText(error, lang.backendMessages));
            setClock(Date.now());
            setPrepareFailed(true);
            setRepairNeeded(!(error instanceof BackendApiError && error.status === 409));
            return false;
        } finally {
            setPreparing(false);
        }
    };
    const [error, setError] = useState("");
    const [needsSettings, setNeedsSettings] = useState(false);
    const [diagnostics, setDiagnostics] = useState("");
    const [clock, setClock] = useState(Date.now());
    useEffect(() => {
        const deleted = (event: Event) => {
            const id = (event as CustomEvent<string>).detail;
            setHistory(rows => rows.filter(row => row.id !== id));
            setRun(value => value?.id === id ? null : value);
            setBatch(value =>
                value?.id === id ? null : value
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
    const refreshProjects = async () => {
        const available = await listProjects();
        setProjects(available);
        setSelected(old => new Set([...old].filter(id => available.some(project => project.project_id === id))));
        return available;
    };
    useEffect(() => {
        let stopped = false;
        const changed = () => {
            void listProjects().then(available => {
                if (stopped) return;
                setProjects(available);
                setSelected(old =>
                    new Set([...old].filter(id => available.some(project => project.project_id === id)))
                );
            }).catch(e => {
                if (!stopped) setError(backendMessageText(e, lang.backendMessages));
            });
        };
        window.addEventListener(PROJECTS_CHANGED_EVENT, changed);
        return () => {
            stopped = true;
            window.removeEventListener(PROJECTS_CHANGED_EVENT, changed);
        };
    }, []);
    const removeResult = async (item: TimingRun) => {
        if (
            await confirm({ message: item.kind === "batch" ? t.removeBatch : t.removeResult, danger: true })
                !== "confirm"
        ) return;
        await deleteTiming(item.id, item.kind);
        setHistory(await timingHistory());
    };
    const retryEligible = canRetryTiming(run, {
        projectId: props.project?.project_id,
        workspaceId: props.workspaceId,
        signature: props.workspaceSignature,
        options: at.options,
    });
    const runMatches = run?.workspace_id === props.workspaceId && run?.lyrics_version === props.workspaceSignature
        && run?.project_id === props.project?.project_id && timingOptionsEqual(at.options, run.options);
    const active = isRunActive(run) || isRunActive(batch);
    useEffect(() => {
        setError("");
        setPrepareFailed(false);
        setDiagnostics("");
        setRun(value =>
            isRunActive(value) || canRetryTiming(value, {
                    projectId: props.project?.project_id,
                    workspaceId: props.workspaceId,
                    signature: props.workspaceSignature,
                    options: at.options,
                })
                ? value
                : null
        );
    }, [props.project?.project_id, props.workspaceId, props.workspaceSignature, JSON.stringify(at.options)]);

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
        if (!active && (!startup || prepareFailed)) return;
        const timer = window.setInterval(() => setClock(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [active, Boolean(startup), prepareFailed]);
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
        setNeedsSettings(false);
        setPrepareFailed(false);
        setStartup(null);
        try {
            await action();
        } catch (e) {
            const message = e instanceof BackendApiError ? e.backendMessage : null;
            const missing = typeof message?.params?.models === "string" ? message.params.models.split(",") : [];
            setError(
                backendMessageText(e, lang.backendMessages)
                    + (missing.length ? ` · ${missing.map(kind => modelName(kind, lang)).join(" / ")}` : ""),
            );
            setNeedsSettings(
                message?.code === "models.not_verified" || message?.code === "runtime.multilingual_failed",
            );
        } finally {
            setStartup(value => value?.stage === "submitting" ? null : value);
            actionLock.current = false;
            setBusy(false);
        }
    };
    return (
        <Panel
            title={
                <>
                    {lang.ui.autoTiming} <StatusPill>Experimental</StatusPill>
                </>
            }
        >
            <Tabs
                ariaLabel={lang.ui.autoTiming}
                value={mode}
                onChange={next => {
                    setMode(next);
                    if (next === "batch") {
                        void act(async () => {
                            await refreshProjects();
                        });
                    }
                }}
                items={[{ value: "single", label: lang.ui.single }, { value: "batch", label: lang.ui.batch }]}
            />
            {mode === "batch" && (
                <Button
                    disabled={busy || active || props.workspaceBusy}
                    onClick={() => {
                        intent.current++;
                        setBatch(null);
                        setSelected(new Set());
                        setError("");
                        setNeedsSettings(false);
                        setPrepareFailed(false);
                        setStartup(null);
                    }}
                >
                    {t.newBatch}
                </Button>
            )}
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
            <AutoTimingFields
                at={at}
                onLanguageChange={language => {
                    languageSaves.current = languageSaves.current.then(() => rememberTimingLanguage(language))
                        .catch(e => setError(backendMessageText(e, lang.backendMessages)));
                }}
            />
            {startup && (
                <TimingStartupProgress
                    stage={prepareFailed
                        ? t.prepareFailed
                        : startup.stage === "checking"
                        ? lang.modelSetup.checkingEnvironment
                        : startup.stage === "preparing"
                        ? lang.modelSetup.preparingEnvironment
                        : t.submitting}
                    startedAt={startup.startedAt}
                    clock={clock}
                    elapsedLabel={lang.settings.runtime.elapsed}
                    failed={prepareFailed}
                    error={error}
                >
                    {prepareFailed && (
                        <Button
                            disabled={busy}
                            onClick={() =>
                                void act(async () => {
                                    if (await prepare(repairNeeded)) setStartup(null);
                                })}
                        >
                            {repairNeeded ? t.repair : t.retry}
                        </Button>
                    )}
                </TimingStartupProgress>
            )}
            {!startup && mode === "single" && run && runMatches && (
                <TimingProgress run={run} lang={lang} clock={clock} />
            )}
            {!startup && mode === "batch" && batch && (
                <>
                    <p className="ui-muted">
                        {t.batchProgress.replace(
                            "{done}",
                            String(batch.runs?.filter(item => !isRunActive(item)).length || 0),
                        ).replace("{total}", String(batch.children.length))}
                    </p>
                    <TimingProgress run={batch.runs?.find(isRunActive) || batch} lang={lang} clock={clock} />
                </>
            )}
            {mode === "single" && run && !runMatches && isRunActive(run) && (
                <>
                    <MessageText role="status">
                        {lang.ui.autoTiming} ·{" "}
                        {projects.find(item => item.project_id === run.project_id)?.metadata.track || run.project_id}
                    </MessageText>
                    <TimingProgress run={run} lang={lang} clock={clock} />
                </>
            )}
            <ButtonGroup className="studio-run-actions">
                <Button
                    tone="primary"
                    disabled={busy || active || props.workspaceBusy
                        || (mode === "single" ? !props.canStart : !selected.size)}
                    onClick={() =>
                        void act(async () => {
                            if (mode === "batch") {
                                const available = await refreshProjects();
                                if ([...selected].some(id => !available.some(project => project.project_id === id))) {
                                    throw new Error(t.selectionChanged);
                                }
                            }
                            if (!await prepare()) return;
                            setStartup(value => value ? { ...value, stage: "submitting" } : value);
                            if (mode === "batch") {
                                setBatch(await startBatch([...selected], at.options));
                                return;
                            }
                            const saved = await props.saveWorkspace();
                            const input = {
                                project_id: saved.project_id,
                                options: at.options,
                                expected_lyrics: saved.plain_lyrics,
                                expected_audio_ref: saved.audio_ref || undefined,
                                workspace_id: props.workspaceId,
                                lyrics_version: props.workspaceSignature,
                            };
                            const next = run
                                    && canRetryTiming(run, {
                                        projectId: saved.project_id,
                                        workspaceId: props.workspaceId,
                                        signature: props.workspaceSignature,
                                        options: at.options,
                                    })
                                ? await retryTiming(run.id, input)
                                : await startTiming(input);
                            setRun(next);
                            props.onRun(next);
                        })}
                >
                    {mode === "single" && retryEligible ? t.retry : t.start}
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
                                    setStartup(value => value ? { ...value, stage: "submitting" } : value);
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
                                    setStartup(value => value ? { ...value, stage: "submitting" } : value);
                                    setBatch(await resumeBatch(batch.id));
                                }
                            })}
                    >
                        {t.resume}
                    </Button>
                )}
            </ButtonGroup>
            {mode === "batch" && batch && (
                <div className="studio-batch-results-header">
                    <h3 className="ui-section-title">{t.results}</h3>
                    <Button tone="danger" disabled={busy || active} onClick={() => void act(() => removeResult(batch))}>
                        {t.deleteBatch}
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
                        deleteDisabled={busy || active || isRunActive(item)}
                        onDelete={() => void act(() => removeResult(item))}
                        onOpen={() => void act(async () => props.onOpen(await getTiming(item.id)))}
                    />
                ))}
            {error && !prepareFailed && <MessageText type="error" role="alert">{error}</MessageText>}
            {needsSettings && (
                <Button onClick={() => window.dispatchEvent(new Event("rollingpebble:auto-timing-settings"))}>
                    {lang.ui.settings}
                </Button>
            )}
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
                        onDelete={() => void act(() => removeResult(item))}
                    />
                ))}
            </details>
            {run && runMatches && (
                <details
                    onToggle={e => {
                        if (e.currentTarget.open) {
                            void act(async () => setDiagnostics((await timingDiagnostics(run.id)).stderr));
                        }
                    }}
                >
                    <summary>{t.diagnostics}</summary>
                    {run.command?.length ? <CommandBlock>{run.command.join(" ")}</CommandBlock> : null}
                    {run.error && <MessageText type="error" role="alert">{run.error}</MessageText>}
                    <LogBlock>{JSON.stringify(run.metrics, null, 2)}{"\n"}{diagnostics}</LogBlock>
                </details>
            )}
        </Panel>
    );
};
