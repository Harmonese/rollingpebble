import { useContext, useRef, useState } from "react";
import { useMessage } from "../../hooks/useMessage.js";

import { backendMessageText } from "../../shared/api/request.js";
import type { MetaModel, NeteaseSong, ProjectModel } from "../../shared/api/types.js";
import { appContext, AppContextBits } from "../../shared/appContext.js";
import { AUDIO_DECODE_WORKER_ERROR, AUDIO_UNSUPPORTED_ERROR, prepareAudioFile } from "../../shared/audioDecode.js";

import { Message, Panel, Tabs } from "../../ui/index.js";
import { NeteaseSearch } from "../shared/NeteaseSearch.js";
import type { NeteaseSearchRenderProps } from "../shared/NeteaseSearch.js";
import { useProjectMetadataSeed } from "../shared/useProjectMetadataSeed.js";
import { useRequestScope } from "../shared/useRequestScope.js";

type AudioSourceKind = "local" | "netease";

function audioImportErrorText(
    error: unknown,
    u: { unsupportedAudioFile: string; audioDecodeWorkerFailed: string },
    backendMessages: Record<string, string | undefined>,
): string {
    const message = (error as Error).message;
    if (message === AUDIO_UNSUPPORTED_ERROR) return u.unsupportedAudioFile;
    if (message === AUDIO_DECODE_WORKER_ERROR) return u.audioDecodeWorkerFailed;
    return backendMessageText(error, backendMessages);
}

export const ImportAudioPanel: React.FC<{
    panelSessionId: string;
    project: ProjectModel | null;
    onImportAudio: (file: File, metadata?: MetaModel) => Promise<boolean>;
    disabled: boolean;
    hasAudio: boolean;
    workspaceId: string;
    editorMeta: MetaModel;
}> = ({ project, onImportAudio, disabled, hasAudio, workspaceId, editorMeta, panelSessionId }) => {
    const currentWorkspace = useRef(workspaceId);
    currentWorkspace.current = workspaceId;
    const operation = useRef(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [source, setSource] = useState<AudioSourceKind>("local");
    const [busy, setBusy] = useState(false);
    const [message, setMessage, , messageFading, messageType, messageKey] = useMessage();
    const { lang } = useContext(appContext, AppContextBits.lang);
    const u = lang.ui;
    const t = lang.toast;
    const { meta } = useProjectMetadataSeed({ project, fallbackMeta: editorMeta, panelSessionId });

    const scope = useRequestScope(panelSessionId);

    const onAudioUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        if (!file || operation.current || disabled) return;
        const valid = scope.begin();
        if (!valid()) return;
        operation.current = true;
        const startedIn = workspaceId;
        setBusy(true);
        setMessage(t.import.preparing, "info");
        try {
            const prepared = await prepareAudioFile(file);
            if (!valid() || startedIn !== currentWorkspace.current) return;
            if (await onImportAudio(prepared.file)) {
                setMessage("");
            } else setMessage("");
        } catch (error) {
            if (valid()) setMessage(audioImportErrorText(error, u, lang.backendMessages), "error");
        } finally {
            if (valid()) {
                operation.current = false;
                setBusy(false);
            }
            ev.target.value = "";
        }
    };

    const loadNeteaseAudio = async (song: NeteaseSong) => {
        if (operation.current || disabled) return;
        const valid = scope.begin();
        if (!valid()) return;
        operation.current = true;
        const startedIn = workspaceId;
        setBusy(true);
        setMessage(t.import.preparing, "info");
        try {
            const response = await fetch(song.playback_url || `/api/netease/audio/${song.id}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            const prepared = await prepareAudioFile(
                new File([blob], `${song.name}.mp3`, { type: blob.type || "audio/mpeg" }),
            );
            if (!valid() || startedIn !== currentWorkspace.current) return;
            await onImportAudio(prepared.file, {
                track: song.name,
                artist: song.artists,
                album: song.album,
                duration: song.duration,
            });
            setMessage("");
        } catch (error) {
            if (valid()) setMessage(audioImportErrorText(error, u, lang.backendMessages), "error");
        } finally {
            if (valid()) {
                operation.current = false;
                setBusy(false);
            }
        }
    };

    const renderLocal = () => (
        <div className="local-file-import">
            <input
                ref={inputRef}
                className="studio-hidden-file"
                type="file"
                accept="audio/*,.mp3,.flac,.wav,.m4a,.aac,.ogg,.opus,.ncm,.qmcflac,.qmcogg,.qmc0,.qmc1,.qmc2,.qmc3"
                onChange={onAudioUpload}
                disabled={busy || disabled}
            />
            <button
                className="studio-import-button compact-import"
                type="button"
                disabled={busy || disabled}
                onClick={() => inputRef.current?.click()}
            >
                <span className="studio-import-icon">+</span>
                <span>
                    <b>{hasAudio ? u.replaceAudio : u.importAudio}</b>
                    <small>{u.importAudioDesc}</small>
                </span>
            </button>
        </div>
    );

    const renderNeteaseActions = ({ song, isCurrent }: NeteaseSearchRenderProps) => (
        <>
            <button
                type="button"
                disabled={busy || disabled}
                onClick={() => {
                    if (isCurrent()) void loadNeteaseAudio(song);
                }}
            >
                {hasAudio ? u.replaceAudio : u.importAudio}
            </button>
            <button type="button" onClick={() => window.open(song.song_url, "_blank", "noopener,noreferrer")}>
                {u.openSong}
            </button>
        </>
    );

    const renderNetease = () => (
        <div className="local-file-import">
            <NeteaseSearch
                panelSessionId={panelSessionId}
                workspaceId={workspaceId}
                defaultQuery=""
                meta={{ track: meta.track, artist: meta.artist, album: meta.album }}
                onMessage={setMessage}
                renderResultActions={renderNeteaseActions}
            />
        </div>
    );

    return (
        <Panel title={u.importAudio} className="audio-import-card">
            <Tabs
                ariaLabel="Audio sources"
                items={[{ value: "local", label: u.localFiles }, { value: "netease", label: u.netease }]}
                value={source}
                onChange={setSource}
            />
            {source === "local" ? renderLocal() : renderNetease()}
            <Message message={message} type={messageType} fading={messageFading} messageKey={messageKey} />
        </Panel>
    );
};
