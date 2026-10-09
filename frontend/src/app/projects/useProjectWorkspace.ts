import { useCallback, useEffect, useRef, useState } from "react";
import type { LyricsTrimOptions } from "../../domain/lyrics/types.js";
import type { Language } from "../../languages/index.js";
import {
    applyLyrics,
    audioMetadata,
    getProject,
    projectAudioUrl,
    saveWorkspace,
    type WorkspaceSnapshot,
} from "../../shared/api/projects.js";
import type { MetaModel, ProjectModel } from "../../shared/api/types.js";
import { loadProjectAudioForPlayback, loadProjectAudioUrlForPlayback } from "../../shared/audioEvents.js";
import { buildImportTextFromProject, hasLyricContent } from "../../shared/lrc.js";
import { notifyProjectsChanged, PROJECTS_CHANGED_EVENT } from "../../shared/projectEvents.js";
import { useConfirmDialog } from "../../ui/ConfirmDialog.js";
import { useLyricsDocument } from "../lyrics/useLyricsDocument.js";

const emptyMeta: MetaModel = { track: "", artist: "", album: "", duration: 0 };

export function useProjectWorkspace(args: { trimOptions: LyricsTrimOptions; prefState: unknown; lang: Language }) {
    const confirm = useConfirmDialog();
    const [project, setProject] = useState<ProjectModel | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [metadata, setMetadata] = useState<MetaModel>(emptyMeta);
    const [provenance, setProvenance] = useState({ source: "manual", lrclib_id: null as number | null });
    const [workspaceId, setWorkspaceId] = useState(() => crypto.randomUUID());
    const [savedSignature, setSavedSignature] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [transitioning, setTransitioning] = useState(false);
    const transitionLock = useRef(false);
    const cleanOnRender = useRef(false);
    const lyrics = useLyricsDocument({ ...args, project: project || { metadata } });
    const snapshot: WorkspaceSnapshot = {
        plain_lyrics: lyrics.plainLyrics,
        synced_lyrics: lyrics.syncedLyrics,
        metadata: lyrics.editorMeta,
        ...provenance,
    };
    const signature = JSON.stringify(snapshot);
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
        if (inFlight.current) return inFlight.current;
        const captured = latest.current;
        setSaving(true);
        const operation = (async () => {
            const saved = captured.project
                ? await applyLyrics(captured.project.project_id, captured.snapshot)
                : await saveWorkspace(captured.workspaceId, captured.file, captured.snapshot);
            if (latest.current.workspaceId === captured.workspaceId) {
                // Never re-import saved text: edits made during upload belong to the editor.
                setProject(saved);
                setSavedSignature(captured.signature);
            }
            notifyProjectsChanged();
            return saved;
        })();
        inFlight.current = operation;
        void operation.finally(() => {
            if (inFlight.current === operation) inFlight.current = null;
            setSaving(false);
        }).catch(() => {});
        return operation;
    }, []);

    const mayReplace = async () => {
        if (inFlight.current) await inFlight.current;
        if (!latest.current.dirty) return true;
        const choice = await confirm({
            message: args.lang.ui.unsavedChanges,
            confirmLabel: args.lang.ui.saveProject,
            discardLabel: args.lang.ui.discardChanges,
        });
        if (choice === "cancel") return false;
        if (choice === "confirm") await save();
        return true;
    };

    const importAudio = async (audio: File) => {
        if (transitionLock.current) return false;
        transitionLock.current = true;
        setTransitioning(true);
        try {
            if (!await mayReplace()) return false;
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
            meta = await audioMetadata(audio.name, meta);
            setProject(null);
            setFile(audio);
            setMetadata(meta);
            setProvenance({ source: "manual", lrclib_id: null });
            setWorkspaceId(crypto.randomUUID());
            setSavedSignature(null);
            lyrics.importText(buildImportTextFromProject({ metadata: meta }));
            loadProjectAudioForPlayback(audio);
            return true;
        } finally {
            transitionLock.current = false;
            setTransitioning(false);
        }
    };

    const openProject = async (projectId: string) => {
        if (transitionLock.current) return;
        transitionLock.current = true;
        setTransitioning(true);
        try {
            if (!await mayReplace()) return;
            const next = await getProject(projectId);
            setProject(next);
            setFile(null);
            setMetadata(next.metadata);
            setProvenance({ source: next.source, lrclib_id: next.lrclib_id ?? null });
            setWorkspaceId(crypto.randomUUID());
            cleanOnRender.current = true;
            lyrics.importProject(next);
            loadProjectAudioUrlForPlayback(next.audio_name ? projectAudioUrl(next.project_id) : "");
        } finally {
            transitionLock.current = false;
            setTransitioning(false);
        }
    };

    const importLyrics = (text: string, origin = { source: "local file", lrclib_id: null as number | null }) => {
        lyrics.importText(text);
        setProvenance(origin);
    };

    const applyJobResult = (id: string, startedSignature: string, next: ProjectModel): boolean => {
        if (latest.current.workspaceId !== id || latest.current.signature !== startedSignature) return false;
        setProject(next);
        setMetadata(next.metadata);
        setProvenance({ source: next.source, lrclib_id: next.lrclib_id ?? null });
        cleanOnRender.current = true;
        lyrics.importProject(next);
        notifyProjectsChanged();
        return true;
    };

    useEffect(() => {
        const onDeleted = (event: Event) => {
            const ids = (event as CustomEvent<string[]>).detail || [];
            if (!ids.includes(latest.current.project?.project_id || "")) return;
            setProject(null);
            setFile(null);
            setMetadata(emptyMeta);
            setProvenance({ source: "manual", lrclib_id: null });
            setWorkspaceId(crypto.randomUUID());
            setSavedSignature(null);
            lyrics.importText("");
            loadProjectAudioUrlForPlayback("");
        };
        window.addEventListener(PROJECTS_CHANGED_EVENT, onDeleted);
        return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, onDeleted);
    }, [lyrics.importText]);

    return {
        project,
        file,
        source: provenance.source,
        lyrics,
        workspaceId,
        signature,
        dirty,
        canSave,
        saving,
        transitioning,
        save,
        importAudio,
        openProject,
        importLyrics,
        applyJobResult,
    };
}
