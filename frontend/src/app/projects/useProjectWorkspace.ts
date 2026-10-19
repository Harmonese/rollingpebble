import { useCallback, useEffect, useRef, useState } from "react";
import { convertTimeToTag, LyricsDocumentActionType as ActionType } from "../../domain/lyrics/lyricsDocument.js";
import type { LyricsTrimOptions } from "../../domain/lyrics/types.js";
import type { Language } from "../../languages/index.js";
import {
    applyLyrics,
    audioMetadata,
    getProject,
    projectAudioUrl,
    replaceWorkspaceAudio,
    saveWorkspace,
    type WorkspaceSnapshot,
} from "../../shared/api/projects.js";
import { clearRecovery, readRecovery, recoveryAudio, writeRecovery } from "../../shared/api/recovery.js";
import type { MetaModel, ProjectModel } from "../../shared/api/types.js";
import { loadProjectAudioForPlayback, loadProjectAudioUrlForPlayback } from "../../shared/audioEvents.js";
import {
    EDITOR_DRAFT_CHANGED,
    editorDraftError,
    flushEditor,
    readEditorRecovery,
    setEditorRecovery,
} from "../../shared/editorDraft.js";
import { hasLyricContent } from "../../shared/lrc.js";
import { notifyProjectsChanged, PROJECTS_CHANGED_EVENT } from "../../shared/projectEvents.js";
import { useConfirmDialog } from "../../ui/ConfirmDialog.js";
import { useLyricsDocument } from "../lyrics/useLyricsDocument.js";

const emptyMeta: MetaModel = { track: "", artist: "", album: "", duration: 0 };

export function useProjectWorkspace(args: { trimOptions: LyricsTrimOptions; prefState: unknown; lang: Language }) {
    const confirm = useConfirmDialog();
    const [project, setProject] = useState<ProjectModel | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [audioRevision, setAudioRevision] = useState("");
    const savedFile = useRef<File | null>(null);
    const draftId = useRef<string>(crypto.randomUUID());
    const recoveredProject = useRef<ProjectModel | null>(null);
    const [provenance, setProvenance] = useState({ source: "manual", lrclib_id: null as number | null });
    const [workspaceId, setWorkspaceId] = useState(() => crypto.randomUUID());
    const [savedSignature, setSavedSignature] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [exiting, setExiting] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const [recoveryError, setRecoveryError] = useState(false);
    const [restorePending, setRestorePending] = useState(false);
    const [ready, setReady] = useState(false);
    const [restoreAttempt, setRestoreAttempt] = useState(0);
    const [draftRevision, setDraftRevision] = useState(0);
    const recoveryQueue = useRef<Promise<unknown>>(Promise.resolve());
    const recoveryAudioKey = useRef("");
    const uploadedRecoveryKey = useRef<string | null>(null);
    const recoveredAudio = useRef<File | null>(null);
    const init = useRef(false);
    const autosaveStart = useRef(0);
    const paused = useRef(false);
    const [transitioning, setTransitioning] = useState(false);
    const transitionLock = useRef(false);
    const cleanOnRender = useRef(false);
    const lyrics = useLyricsDocument(args);
    const snapshot: WorkspaceSnapshot = {
        lyric_document: lyrics.document,
        plain_lyrics: lyrics.plainLyrics,
        synced_lyrics: lyrics.syncedLyrics,
        metadata: lyrics.editorMeta,
        metadata_sources: lyrics.metadataSources,
        ...provenance,
    };
    const signature = JSON.stringify({ snapshot, audioRevision });
    const canSave = Boolean(file || project || hasLyricContent(lyrics.plainLyrics));
    const dirty = canSave && signature !== savedSignature;
    const latest = useRef({ project, file, workspaceId, snapshot, signature, dirty });
    latest.current = { project, file, workspaceId, snapshot, signature, dirty };
    const inFlight = useRef<Promise<ProjectModel> | null>(null);

    useEffect(() => {
        if (cleanOnRender.current) {
            cleanOnRender.current = false;
            setSavedSignature(signature);
        }
    }, [signature, workspaceId]);

    const save = useCallback((): Promise<ProjectModel> => {
        const error = editorDraftError();
        if (error) return Promise.reject(new Error(error));
        if (inFlight.current) return inFlight.current;
        const captured = latest.current;
        const capturedDraftId = draftId.current;
        setSaving(true);
        setSaveError(false);
        const operation = (async () => {
            // Resolve a possibly successful creation before retrying a lost response.
            const existing = captured.project || recoveredProject.current;
            const saved = existing
                ? captured.file && captured.file !== savedFile.current
                    ? await replaceWorkspaceAudio(existing.project_id, captured.file, captured.snapshot)
                    : await applyLyrics(existing.project_id, captured.snapshot)
                : await saveWorkspace(capturedDraftId, captured.file, captured.snapshot).catch(async (error) => {
                    try {
                        const recovered = await getProject(capturedDraftId.replace(/-/g, ""));
                        if (latest.current.workspaceId === captured.workspaceId) recoveredProject.current = recovered;
                    } catch { /* A failed creation has no project to recover. */ }
                    throw error;
                });
            if (latest.current.workspaceId === captured.workspaceId) {
                recoveredProject.current = saved;
                // Never re-import saved text: edits made during upload belong to the editor.
                setProject(saved);
                latest.current.project = saved;
                latest.current.dirty = latest.current.signature !== captured.signature;
                savedFile.current = captured.file;
                setSavedSignature(captured.signature);
            }
            notifyProjectsChanged();
            return saved;
        })().catch(error => {
            if (latest.current.workspaceId === captured.workspaceId) setSaveError(true);
            throw error;
        });
        inFlight.current = operation;
        void operation.finally(() => {
            if (inFlight.current === operation) inFlight.current = null;
            setSaving(false);
        }).catch(() => {});
        return operation;
    }, []);

    const saveNow = async () => {
        await flushEditor();
        // Editor commits render before capturing the save snapshot.
        await new Promise(resolve => setTimeout(resolve, 0));
        let result = await save();
        const id = latest.current.workspaceId;
        while (latest.current.workspaceId === id && latest.current.dirty) {
            await new Promise(resolve => setTimeout(resolve, 0));
            if (!latest.current.dirty) break;
            result = await save();
        }
        return result;
    };

    const mayReplace = async () => {
        await flushEditor();
        if (editorDraftError()) throw new Error(editorDraftError()!);
        await new Promise(resolve => setTimeout(resolve, 0));
        if (inFlight.current) await inFlight.current;
        if (latest.current.project && latest.current.dirty) {
            await saveNow();
            return !latest.current.dirty;
        }
        if (!latest.current.dirty) return true;
        const choice = await confirm({
            message: args.lang.ui.unsavedChanges,
            confirmLabel: args.lang.ui.saveProject,
            discardLabel: args.lang.ui.discardChanges,
        });
        if (choice === "cancel") return false;
        if (choice === "confirm") {
            const capturedSignature = latest.current.signature;
            const capturedId = latest.current.workspaceId;
            await saveNow();
            if (latest.current.signature !== capturedSignature || latest.current.workspaceId !== capturedId) {
                return false;
            }
        } else if (choice === "discard") {
            await recoveryQueue.current.catch(() => {});
            await clearRecovery();
            uploadedRecoveryKey.current = null;
        }
        return true;
    };

    const persistRecovery = () => {
        const value = latest.current;
        const editor = readEditorRecovery();
        const audio = value.file && value.file !== savedFile.current ? value.file : null;
        if (audio && audio !== recoveredAudio.current) {
            recoveredAudio.current = audio;
            recoveryAudioKey.current = crypto.randomUUID();
        }
        const key = audio ? recoveryAudioKey.current : null;
        const record = {
            version: 1 as const,
            project_id: value.project?.project_id || null,
            draft_id: draftId.current,
            snapshot: value.snapshot,
            dirty: value.dirty || Boolean(editor),
            audio_key: key,
            audio_name: audio?.name || null,
            editor,
        };
        const operation = recoveryQueue.current.catch(() => {}).then(async () => {
            if (!record.project_id && !audio && !record.snapshot.plain_lyrics.trim() && !editor) {
                await clearRecovery();
                uploadedRecoveryKey.current = null;
                return null;
            }
            const result = await writeRecovery(record, key !== uploadedRecoveryKey.current ? audio : null);
            uploadedRecoveryKey.current = key;
            return result;
        });
        recoveryQueue.current = operation;
        return operation.then(() => setRecoveryError(false), error => {
            setRecoveryError(true);
            throw error;
        });
    };
    const actions = useRef({ saveNow, persistRecovery, mayReplace });
    actions.current = { saveNow, persistRecovery, mayReplace };

    useEffect(() => {
        const changed = () => setDraftRevision(value => value + 1);
        window.addEventListener(EDITOR_DRAFT_CHANGED, changed);
        return () => window.removeEventListener(EDITOR_DRAFT_CHANGED, changed);
    }, []);

    useEffect(() => {
        if (!ready || paused.current) return;
        const timer = window.setTimeout(() => {
            if (!paused.current && !transitionLock.current) void actions.current.persistRecovery().catch(() => {});
        }, 500);
        return () => window.clearTimeout(timer);
    }, [ready, signature, project?.project_id, dirty, draftRevision, transitioning, exiting]);

    useEffect(() => {
        if (!ready || !project || saveError || saving || transitioning || paused.current) return;
        if (!dirty && !readEditorRecovery()) {
            autosaveStart.current = 0;
            return;
        }
        if (!autosaveStart.current) autosaveStart.current = Date.now();
        const delay = Math.max(0, Math.min(1000, 10000 - (Date.now() - autosaveStart.current)));
        const timer = window.setTimeout(() => {
            autosaveStart.current = 0;
            if (editorDraftError() || paused.current || transitionLock.current) return;
            void actions.current.saveNow().catch(() => {});
        }, delay);
        return () => window.clearTimeout(timer);
    }, [ready, project, signature, dirty, saving, transitioning, saveError, draftRevision, exiting]);

    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.code !== "KeyS") return;
            event.preventDefault();
            if (
                event.repeat || !ready || transitionLock.current || paused.current
                || document.querySelector("[role=\"dialog\"]")
            ) return;
            if (
                !latest.current.project && !latest.current.file && !latest.current.snapshot.plain_lyrics.trim()
                && !readEditorRecovery()
            ) return;
            void actions.current.saveNow().catch(() => setSaveError(true));
        };
        window.addEventListener("keydown", key, true);
        return () => window.removeEventListener("keydown", key, true);
    }, [ready]);

    useEffect(() => {
        if (init.current) return;
        init.current = true;
        void (async () => {
            const record = await readRecovery();
            if (!record) {
                setReady(true);
                return;
            }
            let existing: ProjectModel | null = null;
            if (record.project_id || record.draft_id) {
                try {
                    existing = await getProject(record.project_id || record.draft_id.replace(/-/g, ""));
                } catch (error) {
                    if (!(error instanceof Error && "status" in error && error.status === 404)) throw error;
                }
            }
            let restore = record.dirty || !existing;
            if (restore) {
                const choice = await confirm({
                    message: args.lang.ui.recoverWorkspace,
                    confirmLabel: args.lang.ui.restore,
                    discardLabel: args.lang.ui.discardChanges,
                });
                if (choice === "cancel") {
                    init.current = false;
                    setRestorePending(true);
                    return;
                }
                restore = choice === "confirm";
            }
            const audio = restore ? await recoveryAudio(record) : null;
            setProject(existing);
            latest.current.project = existing;
            setFile(audio);
            savedFile.current = null;
            draftId.current = existing || !record.project_id ? record.draft_id : crypto.randomUUID();
            setProvenance(
                restore
                    ? { source: record.snapshot.source, lrclib_id: record.snapshot.lrclib_id }
                    : { source: existing?.source || "manual", lrclib_id: existing?.lrclib_id || null },
            );
            const next = restore
                ? {
                    ...existing,
                    ...record.snapshot,
                    project_id: existing?.project_id || "",
                    audio_name: audio?.name || existing?.audio_name,
                } as ProjectModel
                : existing;
            if (next) lyrics.importProject(next);
            else await lyrics.importText("", false, true);
            cleanOnRender.current = !restore;
            setWorkspaceId(crypto.randomUUID());
            if (audio) loadProjectAudioForPlayback(audio);
            else loadProjectAudioUrlForPlayback(existing?.audio_name ? projectAudioUrl(existing.project_id) : "");
            setEditorRecovery(restore ? record.editor : null);
            if (!restore) await clearRecovery();
            setReady(true);
            setRestorePending(false);
            setRecoveryError(false);
        })().catch(() => {
            init.current = false;
            setRecoveryError(true);
        });
    }, [restoreAttempt]);

    const prepareExit = async (flushReview: () => Promise<void>) => {
        if (!ready || transitionLock.current) return false;
        transitionLock.current = true;
        setExiting(true);
        paused.current = true;
        let leaving = false;
        try {
            for (;;) {
                try {
                    await flushReview();
                    if (!await actions.current.mayReplace()) return false;
                    // A discarded temporary workspace must not reappear next launch.
                    await recoveryQueue.current.catch(() => {});
                    if (!latest.current.project) await clearRecovery();
                    else await actions.current.persistRecovery();
                    leaving = true;
                    return true;
                } catch {
                    const choice = await confirm({
                        message: args.lang.ui.saveFailed,
                        confirmLabel: args.lang.ui.retrySave,
                        discardLabel: args.lang.ui.discardChanges,
                    });
                    if (choice === "cancel") return false;
                    if (choice === "discard") {
                        await recoveryQueue.current.catch(() => {});
                        await clearRecovery();
                        leaving = true;
                        return true;
                    }
                }
            }
        } finally {
            paused.current = leaving;
            if (!leaving) {
                transitionLock.current = false;
                setExiting(false);
            }
        }
    };

    const importAudio = async (audio: File, suppliedMetadata?: MetaModel) => {
        if (transitionLock.current || latest.current.workspaceId !== workspaceId) return false;
        transitionLock.current = true;
        setTransitioning(true);
        try {
            if (inFlight.current) await inFlight.current;
            const capturedId = latest.current.workspaceId;
            const stem = audio.name.replace(/\.[^.]+$/, "");
            let meta = { ...emptyMeta, track: stem };
            try {
                const { parseBlob } = await import("music-metadata");
                const tags = await parseBlob(audio, { skipCovers: true });
                meta = {
                    track: tags.common.title || stem,
                    artist: tags.common.artist || "",
                    album: tags.common.album || "",
                    duration: Math.round(tags.format.duration || 0),
                };
            } catch { /* Untagged or unsupported metadata must not prevent playback. */ }
            // Only tag text and the filename are sent; the audio stays in the WebView.
            meta = await audioMetadata(audio.name, suppliedMetadata || meta);
            if (latest.current.workspaceId !== capturedId) return false;
            setFile(audio);

            setAudioRevision(crypto.randomUUID());
            setWorkspaceId(crypto.randomUUID());
            const current = latest.current.snapshot.metadata;
            const sources = { ...latest.current.snapshot.metadata_sources };
            const replacement = { ...meta };
            for (const key of ["track", "artist", "album"] as const) {
                if (sources[key] && sources[key] !== "audio") replacement[key] = current[key];
                else sources[key] = "audio";
            }
            lyrics.updateSources(sources);
            for (
                const [name, value] of Object.entries({
                    ti: replacement.track,
                    ar: replacement.artist,
                    al: replacement.album,
                    length: convertTimeToTag(meta.duration, 0, false),
                })
            ) lyrics.rawDispatch({ type: ActionType.info, payload: { name, value } });
            loadProjectAudioForPlayback(audio);
            return true;
        } finally {
            transitionLock.current = false;
            setTransitioning(false);
        }
    };

    const openProject = async (projectId: string) => {
        if (transitionLock.current) return false;
        transitionLock.current = true;
        setTransitioning(true);
        try {
            if (!await mayReplace()) return false;
            const capturedId = latest.current.workspaceId;
            const capturedSignature = latest.current.signature;
            const next = await getProject(projectId);
            if (latest.current.workspaceId !== capturedId || latest.current.signature !== capturedSignature) {
                return false;
            }
            setProject(next);
            setEditorRecovery(null);
            setSaveError(false);
            setFile(null);
            recoveredProject.current = null;
            draftId.current = crypto.randomUUID();
            savedFile.current = null;
            setAudioRevision("");

            setProvenance({ source: next.source, lrclib_id: next.lrclib_id ?? null });
            setWorkspaceId(crypto.randomUUID());
            cleanOnRender.current = true;
            lyrics.importProject(next);
            loadProjectAudioUrlForPlayback(next.audio_name ? projectAudioUrl(next.project_id) : "");
            return true;
        } finally {
            transitionLock.current = false;
            setTransitioning(false);
        }
    };

    const importLyrics = async (text: string, origin = { source: "local file", lrclib_id: null as number | null }) => {
        if (latest.current.workspaceId !== workspaceId) return;
        if (!await lyrics.importText(text, true)) return;
        if (latest.current.file || latest.current.project?.audio_name) {
            lyrics.rawDispatch({
                type: ActionType.info,
                payload: {
                    name: "length",
                    value: convertTimeToTag(latest.current.snapshot.metadata.duration, 0, false),
                },
            });
        }
        setProvenance(origin);
    };

    const applyJobResult = (id: string, startedSignature: string, next: ProjectModel): boolean => {
        if (latest.current.workspaceId !== id || latest.current.signature !== startedSignature) return false;
        setProject(next);

        setProvenance({ source: next.source, lrclib_id: next.lrclib_id ?? null });
        cleanOnRender.current = true;
        lyrics.importProject(next);
        notifyProjectsChanged();
        return true;
    };

    const resetWorkspace = useCallback(() => {
        setEditorRecovery(null);
        setSaveError(false);
        setProject(null);
        setFile(null);
        recoveredProject.current = null;
        draftId.current = crypto.randomUUID();
        savedFile.current = null;
        setAudioRevision("");

        setProvenance({ source: "manual", lrclib_id: null });
        const nextId = crypto.randomUUID();
        latest.current.workspaceId = nextId;
        setWorkspaceId(nextId);
        setSavedSignature(null);
        void lyrics.importText("", false, true);
        loadProjectAudioUrlForPlayback("");
        lyrics.rawDispatch({ type: ActionType.select, payload: () => 0 });
    }, [lyrics.importText, lyrics.rawDispatch]);

    const newProject = async () => {
        if (transitionLock.current) return false;
        transitionLock.current = true;
        setTransitioning(true);
        try {
            if (!await mayReplace()) return false;
            resetWorkspace();
            return true;
        } finally {
            transitionLock.current = false;
            setTransitioning(false);
        }
    };

    useEffect(() => {
        const onDeleted = (event: Event) => {
            const ids = (event as CustomEvent<string[]>).detail || [];
            if (!ids.includes(latest.current.project?.project_id || "")) return;
            resetWorkspace();
        };
        window.addEventListener(PROJECTS_CHANGED_EVENT, onDeleted);
        return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, onDeleted);
    }, [resetWorkspace]);

    return {
        exiting,
        ready,
        restorePending,
        saveError,
        recoveryError,
        retryRecovery: () =>
            ready ? void actions.current.persistRecovery().catch(() => {}) : setRestoreAttempt(value => value + 1),
        discardRecovery: async () => {
            if (
                await confirm({
                    message: args.lang.ui.discardChanges,
                    confirmLabel: args.lang.ui.discardChanges,
                    danger: true,
                }) !== "confirm"
            ) return;
            try {
                await clearRecovery();
                setRecoveryError(false);
                setRestorePending(false);
                setReady(true);
            } catch {
                setRecoveryError(true);
            }
        },
        prepareExit,
        project,
        file,
        audioPending: Boolean(file && file !== savedFile.current),
        source: provenance.source,
        lyrics,
        workspaceId,
        signature,
        dirty: dirty || Boolean(readEditorRecovery()),
        canSave: canSave || Boolean(readEditorRecovery()),
        saving,
        transitioning,
        save: saveNow,
        mayReplace,
        importAudio,
        openProject,
        newProject,
        importLyrics,
        applyJobResult,
    };
}
