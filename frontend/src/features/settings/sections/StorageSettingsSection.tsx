import { useContext, useEffect, useRef, useState } from "react";
import { deleteProject } from "../../../shared/api/projects.js";
import { backendMessageText, request } from "../../../shared/api/request.js";
import {
    clearStorageCache,
    openStorageFolder,
    relocateStorage,
    type StorageUsage,
    storageUsage,
} from "../../../shared/api/storage.js";
import { deleteTiming, isRunActive, timingHistory, type TimingRun } from "../../../shared/api/timingV2.js";
import { appContext } from "../../../shared/appContext.js";
import { formatBytes } from "../../../shared/format.js";
import { notifyProjectsChanged } from "../../../shared/projectEvents.js";
import { notifySettingsUpdated } from "../../../shared/settingsEvents.js";
import { prepareStorageTransition } from "../../../shared/storageTransition.js";
import { useConfirmDialog } from "../../../ui/ConfirmDialog.js";
import { ActionRow, Button, ButtonGroup, CheckRow, MessageText, SectionTitle } from "../../../ui/index.js";
import { Modal } from "../../../ui/Modal.js";

export function StorageSettingsSection({ title, onModels }: { title: string; onModels: () => void }) {
    const { lang } = useContext(appContext);
    const t = lang.storageV3;
    const confirm = useConfirmDialog();
    const [usage, setUsage] = useState<StorageUsage | null>(null);
    const [manager, setManager] = useState<"projects" | "results" | null>(null);
    const [runs, setRuns] = useState<TimingRun[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const actionLock = useRef(false);
    const [moving, setMoving] = useState(false);
    const [error, setError] = useState("");
    const locked = busy || usage?.migration.status === "moving";
    const refresh = async () => {
        const [next, history] = await Promise.all([storageUsage(), timingHistory()]);
        setUsage(next);
        setRuns(history.filter(run => run.kind === "run"));
    };
    useEffect(() => {
        void refresh().catch(e => setError(backendMessageText(e, lang.backendMessages)));
    }, []);
    useEffect(() => {
        if (usage?.migration.status !== "moving") return;
        const timer = window.setInterval(() => void refresh().catch(() => {}), 1000);
        return () => window.clearInterval(timer);
    }, [usage?.migration.status]);
    const act = async (action: () => Promise<void>) => {
        if (actionLock.current || usage?.migration.status === "moving") return;
        actionLock.current = true;
        setBusy(true);
        setError("");
        try {
            await action();
            await refresh();
        } catch (e) {
            setError(backendMessageText(e, lang.backendMessages));
        } finally {
            await refresh().catch(() => {});
            actionLock.current = false;
            setBusy(false);
            setMoving(false);
        }
    };
    const move = async () => {
        const selection = await request<{ path: string; canceled: boolean }>("/api/local/select-path", {
            method: "POST",
            body: JSON.stringify({ mode: "directory", title: t.changeLocation, initial_path: usage?.data_dir }),
        });
        if (selection.canceled || !selection.path || selection.path === usage?.data_dir) return;
        if (await confirm({ message: t.confirmMove.replace("{path}", selection.path) }) !== "confirm") return;
        if (!await prepareStorageTransition()) return;
        setMoving(true);
        setUsage(await relocateStorage(selection.path));
        notifySettingsUpdated();
    };
    const removeSelected = async () => {
        if (
            !selected.length
            || await confirm({ message: t.confirmDelete.replace("{count}", String(selected.length)), danger: true })
                !== "confirm"
        ) return;
        for (const id of selected) {
            if (manager === "projects") {
                await deleteProject(id);
                notifyProjectsChanged([id]);
            } else await deleteTiming(id);
            setSelected(current => current.filter(value => value !== id));
        }
        setSelected([]);
    };
    return (
        <section className="settings-section">
            <h3>{title}</h3>
            <div className="settings-subsection">
                <SectionTitle>{t.location}</SectionTitle>
                <ActionRow title={formatBytes(usage?.total_bytes)} description={usage?.data_dir}>
                    <Button
                        disabled={locked}
                        onClick={() =>
                            void act(async () => {
                                await openStorageFolder();
                            })}
                    >
                        {lang.settings.common.openFolder}
                    </Button>
                    <Button disabled={locked || !usage} onClick={() => void act(move)}>
                        {moving || usage?.migration.status === "moving" ? t.moving : t.changeLocation}
                    </Button>
                </ActionRow>
            </div>
            <div className="settings-subsection">
                <SectionTitle>{t.usage}</SectionTitle>
                {(["projects", "models", "results", "cache", "components"] as const).map(id => (
                    <ActionRow
                        key={id}
                        title={t[id]}
                        description={formatBytes(usage?.categories.find(row => row.id === id)?.bytes)}
                    >
                        {(id === "projects" || id === "results") && (
                            <Button
                                disabled={locked}
                                onClick={() => {
                                    setManager(id);
                                    setSelected([]);
                                }}
                            >
                                {t.manage}
                            </Button>
                        )}
                        {id === "models" && <Button disabled={locked} onClick={onModels}>{t.manage}</Button>}
                        {id === "cache" && (
                            <Button
                                disabled={locked || !usage}
                                onClick={() =>
                                    void act(async () => {
                                        if (await confirm({ message: t.confirmCache, danger: true }) === "confirm") {
                                            setUsage(await clearStorageCache());
                                        }
                                    })}
                            >
                                {lang.timingV2.clear}
                            </Button>
                        )}
                    </ActionRow>
                ))}
            </div>
            {error && <MessageText type="error">{error}</MessageText>}
            <Modal
                open={manager !== null}
                onClose={() => {
                    if (!locked) setManager(null);
                }}
                ariaLabel={manager ? t[manager] : t.manage}
            >
                <div className="settings-section">
                    <h3>{manager ? t[manager] : t.manage}</h3>
                    <ButtonGroup>
                        <Button
                            disabled={locked}
                            onClick={() =>
                                setSelected(
                                    manager === "projects"
                                        ? (usage?.projects.map(p => p.project_id) || [])
                                        : runs.filter(r => !isRunActive(r)).map(r => r.id),
                                )}
                        >
                            {t.selectAll}
                        </Button>
                        <Button
                            tone="danger"
                            disabled={locked || selected.length === 0}
                            onClick={() => void act(removeSelected)}
                        >
                            {lang.settings.common.delete}
                        </Button>
                        <Button disabled={locked} onClick={() => setManager(null)}>{lang.ui.close}</Button>
                    </ButtonGroup>
                    {(manager === "projects" ? usage?.projects || [] : runs).map(item => {
                        const projectItem = "total_bytes" in item;
                        const id = projectItem ? item.project_id : item.id;
                        const label = projectItem
                            ? item.title
                            : (usage?.projects.find(p => p.project_id === item.project_id)?.title || item.project_id);
                        const detail = projectItem
                            ? formatBytes(item.total_bytes)
                            : new Date(item.created_at).toLocaleString() + " · " + lang.timingV2[item.status];
                        return (
                            <CheckRow
                                key={id}
                                title={label}
                                description={detail}
                                checked={selected.includes(id)}
                                disabled={locked || (!projectItem && isRunActive(item))}
                                onChange={checked =>
                                    setSelected(current =>
                                        checked ? [...current, id] : current.filter(value => value !== id)
                                    )}
                            />
                        );
                    })}
                    {(manager === "projects" ? usage?.projects.length === 0 : runs.length === 0) && (
                        <MessageText>{lang.ui.noResultsFound}</MessageText>
                    )}
                    {error && <MessageText type="error">{error}</MessageText>}
                </div>
            </Modal>
        </section>
    );
}
