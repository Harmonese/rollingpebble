import { useContext, useEffect, useRef, useState } from "react";
import { LyricsDocumentActionType, lyricsDocumentSyncedText } from "../domain/lyrics/lyricsDocument.js";
import { LrcUtilsPanel } from "../features/lrc-utils/LrcUtilsPanel.js";
import { LrclibPanel } from "../features/lrclib/LrclibPanel.js";
import { ImportAudioPanel } from "../features/project/ImportAudioPanel.js";
import { ProjectPanel } from "../features/project/ProjectPanel.js";
import { useTimingBinding } from "../features/roller/controllers/useTimingBinding.js";
import { useTimingPreview } from "../features/roller/controllers/useTimingPreview.js";
import { showPreviewEditor } from "../features/roller/previewPresentation.js";
import { RollerPanel } from "../features/roller/RollerPanel.js";
import { useTranslation } from "../features/translation/useTranslation.js";
import { UploadPanel } from "../features/upload/UploadPanel.js";
import { useTextFileDrop } from "../hooks/useTextFileDrop.js";
import { backendMessageText } from "../shared/api/request.js";
import { TIMING_DELETED_EVENT } from "../shared/api/timingV2.js";
import { getTiming, isRunActive, recordApplied, timingBinding, type TimingRun } from "../shared/api/timingV2.js";
import { appContext } from "../shared/appContext.js";
import { registerDesktopExit } from "../shared/desktopExit.js";
import { registerStorageTransition } from "../shared/storageTransition.js";
import { useConfirmDialog } from "../ui/ConfirmDialog.js";
import { Button, MessageText, StatusPill, TaskStatus } from "../ui/index.js";
import { toastPubSub } from "../ui/Toast.js";
import { LyricsWorkspace } from "./lyrics/LyricsWorkspace.js";
import { useProjectWorkspace } from "./projects/useProjectWorkspace.js";
import "./workspace.css";

export const WorkspaceShell: React.FC = () => {
    const { prefState, lang, trimOptions } = useContext(appContext);
    useEffect(() => {
        const failed = () => toastPubSub.pub({ type: "error", text: lang.ui.externalLinkFailed });
        window.addEventListener("rollingpebble:external-link-failed", failed);
        return () => window.removeEventListener("rollingpebble:external-link-failed", failed);
    }, [lang.ui.externalLinkFailed]);
    const workspace = useProjectWorkspace({ trimOptions, prefState, lang });
    const { project, lyrics } = workspace;
    const translation = useTranslation(lyrics.state, lyrics.dispatch, workspace.workspaceId);
    const [run, setRun] = useState<TimingRun | null>(null);
    useEffect(() => {
        const deleted = (event: Event) =>
            setRun(value => value?.id === (event as CustomEvent<string>).detail ? null : value);
        window.addEventListener(TIMING_DELETED_EVENT, deleted);
        return () => window.removeEventListener(TIMING_DELETED_EVENT, deleted);
    }, []);
    const preview = useTimingPreview(run);
    useEffect(() =>
        registerStorageTransition(async () => {
            await preview.flush();
            return workspace.mayReplace();
        }), [preview.flush, workspace.mayReplace]);
    const confirm = useConfirmDialog();

    const [previewError, setPreviewError] = useState("");
    const current = useRef(workspace);
    current.current = workspace;
    const exitReview = useRef(preview.flush);
    exitReview.current = preview.flush;
    useEffect(() => {
        if (!workspace.ready) return;
        return registerDesktopExit(() => current.current.prepareExit(() => exitReview.current()));
    }, [workspace.ready]);
    const t = lang.timingV2;
    const binding = useTimingBinding(
        run?.id,
        project?.project_id,
        run?.project_id,
        workspace.workspaceId,
        workspace.audioPending,
        project?.audio_ref,
    );
    const bound = binding === "matched";
    const [previewUtils, setPreviewUtils] = useState(false);
    useEffect(() => {
        if (!bound) setPreviewUtils(false);
    }, [bound]);
    useEffect(() => {
        if (!run || !isRunActive(run)) return;
        let stopped = false;
        const poll = async () => {
            try {
                const next = await getTiming(run.id);
                if (!stopped) setRun(next);
            } catch (e) {
                if (!stopped) setPreviewError(backendMessageText(e, lang.backendMessages));
            }
            if (!stopped) timer = window.setTimeout(poll, 1000);
        };
        let timer = window.setTimeout(poll, 1000);
        return () => {
            stopped = true;
            window.clearTimeout(timer);
        };
    }, [run?.id, run?.status]);
    const reviewActionLock = useRef(false);
    const [reviewBusy, setReviewBusy] = useState(false);
    const reviewRun = useRef(run);
    reviewRun.current = run;
    const previewAction = async (action: () => Promise<void>) => {
        if (reviewActionLock.current) return;
        reviewActionLock.current = true;
        setReviewBusy(true);
        setPreviewError("");
        try {
            await action();
        } catch (e) {
            setPreviewError(backendMessageText(e, lang.backendMessages));
        } finally {
            reviewActionLock.current = false;
            setReviewBusy(false);
        }
    };
    const openRun = async (next: TimingRun) => {
        await preview.flush();
        if (next.project_id !== current.current.project?.project_id) {
            if (!await workspace.openProject(next.project_id)) return;
        }
        setRun(next);
    };
    const applyPreview = async () => {
        if (!run || !bound || isRunActive(run)) return;
        const before = current.current;
        await preview.flush();
        if (
            reviewRun.current?.id !== run.id || current.current.workspaceId !== before.workspaceId
            || current.current.signature !== before.signature || current.current.audioPending
            || current.current.project?.project_id !== run.project_id
        ) return;
        const content = preview.currentState();
        const partial = run.status !== "completed";
        const changed = run.lyrics_version !== before.signature;
        const empty = !content.lyric.length;
        if (
            (partial || changed || empty)
            && await confirm({ message: partial ? t.applyPartial : empty ? t.applyEmpty : t.replace }) !== "confirm"
        ) return;
        const now = current.current;
        if (
            now.project?.project_id !== run.project_id || now.audioPending || now.workspaceId !== before.workspaceId
            || now.signature !== before.signature || !(await timingBinding(run.id)).matches
        ) return;
        if (
            reviewRun.current?.id !== run.id || current.current.audioPending
            || current.current.project?.project_id !== run.project_id
            || current.current.signature !== now.signature || current.current.workspaceId !== now.workspaceId
            || preview.currentState().lyric !== content.lyric
        ) return;
        if (!await workspace.lyrics.importText(lyricsDocumentSyncedText(content, prefState, false), true)) return;
        const applied = await recordApplied(run.id, preview.version());
        if (reviewRun.current?.id === run.id) setRun(applied);
    };
    const previewView = run && (
        <div className="timing-preview">
            <div className="timing-preview-actions">
                <StatusPill title={t.languageHint}>{lang.autoTimingLanguages[run.language || "en"]}</StatusPill>
                <StatusPill>
                    {isRunActive(run)
                        ? (preview.edited ? t.edited : t.following)
                        : run.status !== "completed"
                        ? t.partial
                        : run.applied.length
                        ? t.applied
                        : t.ready}
                </StatusPill>
                <Button
                    disabled={reviewBusy || !run.snapshot || !preview.loaded || preview.saving
                        || Boolean(preview.error)}
                    onClick={() =>
                        void previewAction(async () => {
                            if (preview.edited && await confirm({ message: t.discard }) !== "confirm") return;
                            await preview.useLatest(run.id);
                        })}
                >
                    {t.latest}
                </Button>
                <Button
                    tone="primary"
                    disabled={reviewBusy || !bound || isRunActive(run) || !preview.loaded || preview.saving
                        || Boolean(preview.error)
                        || (!run.snapshot && !preview.edited)}
                    onClick={() => void previewAction(applyPreview)}
                >
                    {t.apply}
                </Button>
                <Button
                    disabled={!preview.loaded || (!run.snapshot && !preview.edited)}
                    onClick={() => {
                        const url = URL.createObjectURL(
                            new Blob([lyricsDocumentSyncedText(preview.currentState(), prefState, false)], {
                                type: "text/plain;charset=utf-8",
                            }),
                        );
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = "preview.lrc";
                        link.click();
                        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}
                >
                    {t.export}
                </Button>
            </div>
            {preview.loaded && preview.state.lyric.some(line => line.time === undefined) && (
                <span className="timing-preview-waiting">
                    {t.unaligned} · {preview.state.lyric.filter(line => line.time === undefined).length}
                </span>
            )}
            {preview.error && (
                <MessageText type="error" role="alert">
                    {preview.loaded ? t.saveFailed : t.loadFailed}{" "}
                    <Button onClick={() => void preview.retrySave()}>{t.retry}</Button>
                </MessageText>
            )}
            {previewError && <MessageText type="error" role="alert">{previewError}</MessageText>}
            {binding === "mismatched" && <MessageText type="warning">{t.audioChanged}</MessageText>}
            {binding === "failed" && <MessageText type="error" role="alert">{t.bindingFailed}</MessageText>}
            {preview.saving && <MessageText type="info" role="status">{t.saving}</MessageText>}
            {showPreviewEditor(run, preview.loaded, preview.edited)
                ? (
                    <LyricsWorkspace
                        lang={lang}
                        state={preview.state}
                        dispatch={preview.dispatch}
                        includeMetadataTags={false}
                        onOpenUtils={() => setPreviewUtils(true)}
                        readOnly={!bound || reviewBusy}
                    />
                )
                : (
                    <TaskStatus
                        title={t[run.progress?.stage as keyof typeof t] || run.progress?.stage || t.waiting}
                        active={isRunActive(run)}
                    />
                )}
        </div>
    );
    const [utilsOpen, setUtilsOpen] = useState(false);
    useTextFileDrop(workspace.importLyrics);

    if (!workspace.ready) {
        return (
            <main className="workspace-shell workspace-recovery-gate">
                <section
                    className="ui-panel workspace-recovery-card"
                    aria-busy={!workspace.restorePending && !workspace.recoveryError}
                >
                    <h1 className="ui-panel-title">{lang.ui.restore}</h1>
                    <p role={workspace.recoveryError ? "alert" : "status"}>
                        {workspace.recoveryError ? lang.ui.recoveryFailed : lang.ui.recoverWorkspace}
                    </p>
                    {(workspace.restorePending || workspace.recoveryError) && (
                        <div className="ui-dialog-action-row">
                            <Button onClick={() => void workspace.discardRecovery()}>{lang.ui.discardChanges}</Button>
                            <Button tone="primary" onClick={workspace.retryRecovery}>
                                {workspace.recoveryError ? lang.ui.retrySave : lang.ui.restore}
                            </Button>
                        </div>
                    )}
                </section>
            </main>
        );
    }
    return (
        <main
            className="workspace-shell studio-main"
            aria-busy={workspace.exiting}
            ref={element => {
                if (element) element.inert = workspace.exiting;
            }}
        >
            <aside className="workspace-rail workspace-rail-left studio-side left">
                <ProjectPanel
                    project={project}
                    onOpenProject={async id => {
                        await preview.flush();
                        await workspace.openProject(id);
                    }}
                    onSave={workspace.save}
                    onNewProject={async () => {
                        await preview.flush();
                        if (await workspace.newProject()) {
                            setRun(null);
                            setPreviewError("");
                            setUtilsOpen(false);
                        }
                    }}
                    draftAudioName={workspace.file?.name}
                    draftMetadata={workspace.canSave ? lyrics.editorMeta : undefined}
                    draftSource={workspace.canSave ? workspace.source : undefined}
                    dirty={workspace.dirty}
                    canSave={workspace.canSave}
                    saving={workspace.saving}
                    saveError={workspace.saveError}
                    transitioning={workspace.transitioning}
                />
                {workspace.recoveryError && (
                    <Button onClick={workspace.retryRecovery}>{lang.ui.recoveryFailed} · {lang.ui.retrySave}</Button>
                )}
                <ImportAudioPanel
                    key={`import-audio:${workspace.panelSessionId}`}
                    panelSessionId={workspace.panelSessionId}
                    project={project}
                    onImportAudio={workspace.importAudio}
                    workspaceId={workspace.workspaceId}
                    hasAudio={Boolean(workspace.file || project?.audio_name)}
                    editorMeta={lyrics.editorMeta}
                    disabled={workspace.saving || workspace.transitioning}
                />
                <LrclibPanel
                    workspaceId={workspace.workspaceId}
                    key={`import-lyrics:${workspace.panelSessionId}`}
                    panelSessionId={workspace.panelSessionId}
                    project={project}
                    editorMeta={lyrics.editorMeta}
                    onImportText={workspace.importLyrics}
                />
            </aside>

            <LyricsWorkspace
                preview={previewView}
                translation={translation}
                lang={lang}
                state={lyrics.state}
                dispatch={lyrics.dispatch}
                includeMetadataTags={lyrics.includeMetadataTags}
                onOpenUtils={() => setUtilsOpen(true)}
            />

            <aside className="workspace-rail workspace-rail-right studio-side right">
                <RollerPanel
                    project={project}
                    saveWorkspace={async () => {
                        const before = current.current;
                        await preview.flush();
                        const saved = await workspace.save();
                        if (
                            current.current.workspaceId !== before.workspaceId
                            || current.current.signature !== before.signature
                        ) throw new Error(lang.ui.workspaceChanged);
                        return saved;
                    }}
                    workspaceId={workspace.workspaceId}
                    workspaceSignature={workspace.signature}
                    workspaceBusy={workspace.saving || workspace.transitioning}
                    canStart={Boolean(lyrics.plainLyrics.trim() && (workspace.file || project?.audio_name))}
                    onRun={next =>
                        setRun(previous =>
                            previous?.id === next.id
                                || (next.workspace_id === current.current.workspaceId
                                    && next.project_id === current.current.project?.project_id)
                                ? next
                                : previous
                        )}
                    onOpen={openRun}
                    onDelete={id => setRun(previous => previous?.id === id ? null : previous)}
                />
                <UploadPanel
                    workspaceId={workspace.workspaceId}
                    key={`upload-lyrics:${workspace.panelSessionId}`}
                    panelSessionId={workspace.panelSessionId}
                    project={project}
                    plainLyrics={lyrics.plainLyrics}
                    syncedLyrics={lyrics.syncedLyrics}
                    editorMeta={lyrics.editorMeta}
                    onSave={workspace.save}
                />
            </aside>

            <LrcUtilsPanel
                open={previewUtils}
                text={lyricsDocumentSyncedText(preview.state, prefState, false)}
                onClose={() => setPreviewUtils(false)}
                onApply={text => {
                    if (!bound) return;
                    preview.dispatch({ type: LyricsDocumentActionType.parse, payload: { text, options: trimOptions } });
                    setPreviewUtils(false);
                }}
            />
            <LrcUtilsPanel
                open={utilsOpen}
                text={lyrics.syncedLyrics}
                onClose={() => setUtilsOpen(false)}
                onApply={(newText) => {
                    lyrics.importText(newText);
                    setUtilsOpen(false);
                }}
            />
        </main>
    );
};
