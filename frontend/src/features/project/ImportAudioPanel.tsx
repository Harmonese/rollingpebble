import { useContext, useRef, useState } from "react";
import { useMessage } from "../../hooks/useMessage.js";
import { toastPubSub } from "../../ui/Toast.js";

import { backendMessageText } from "../../shared/api/request.js";
import type { NeteaseSong, ProjectModel } from "../../shared/api/types.js";
import { appContext, AppContextBits } from "../../shared/appContext.js";
import { AUDIO_DECODE_WORKER_ERROR, AUDIO_UNSUPPORTED_ERROR, prepareAudioFile } from "../../shared/audioDecode.js";
import { loadProjectAudioUrlForPlayback } from "../../shared/audioEvents.js";
import { Message, Panel, Tabs } from "../../ui/index.js";
import { NeteaseSearch } from "../shared/NeteaseSearch.js";
import type { NeteaseSearchRenderProps } from "../shared/NeteaseSearch.js";
import { useProjectMetadataSeed } from "../shared/useProjectMetadataSeed.js";

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
    project: ProjectModel | null;
    onImportAudio: (file: File) => Promise<boolean>;
    disabled: boolean;
}> = ({ project, onImportAudio, disabled }) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [source, setSource] = useState<AudioSourceKind>("local");
    const [busy, setBusy] = useState(false);
    const [message, setMessage, , messageFading, messageType, messageKey] = useMessage();
    const { lang } = useContext(appContext, AppContextBits.lang);
    const u = lang.ui;
    const t = lang.toast;
    const { meta } = useProjectMetadataSeed({ project });

    const onAudioUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        setBusy(true);
        setMessage(t.import.preparing, "info");
        try {
            const prepared = await prepareAudioFile(file);
            if (await onImportAudio(prepared.file)) {
                setMessage("");
            } else setMessage("");
        } catch (error) {
            setMessage(audioImportErrorText(error, u, lang.backendMessages), "error");
        } finally {
            setBusy(false);
            ev.target.value = "";
        }
    };

    const loadNeteaseAudio = (song: NeteaseSong) => {
        toastPubSub.pub({
            type: "info",
            text: t.netease.loadingAudio.replace("{label}", song.label || String(song.id)),
        });
        loadProjectAudioUrlForPlayback(song.playback_url || song.outer_audio_url, song.outer_audio_url || undefined);
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
                    <b>{u.importAudio}</b>
                    <small>{u.importAudioDesc}</small>
                </span>
            </button>
        </div>
    );

    const renderNeteaseActions = ({ song }: NeteaseSearchRenderProps) => (
        <>
            <button type="button" onClick={() => loadNeteaseAudio(song)}>{u.loadAudioLink}</button>
            <button type="button" onClick={() => window.open(song.song_url, "_blank", "noopener,noreferrer")}>
                {u.openSong}
            </button>
        </>
    );

    const renderNetease = () => (
        <div className="local-file-import">
            <NeteaseSearch
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
