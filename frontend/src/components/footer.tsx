import SSK from "#const/session_key.json" with { type: "json" };
import { useCallback, useContext, useEffect, useReducer, useRef } from "react";
import { useAudio } from "../hooks/useAudio.js";
import { useKeyBindings } from "../hooks/useKeyBindings.js";
import { AUDIO_DECODE_WORKER_ERROR, AUDIO_UNSUPPORTED_ERROR, prepareAudioFile } from "../shared/audioDecode.js";
import { LOAD_PROJECT_AUDIO_EVENT, type ProjectAudioLoadDetail } from "../shared/audioEvents.js";
import { AudioActionType, audioStatePubSub, currentTimePubSub } from "../utils/audiomodule.js";
import { InputAction } from "../utils/input-action.js";
import { isKeyboardElement } from "../utils/is-keyboard-element.js";
import { getMatchedAction } from "../utils/keybindings.js";
import { appContext, AudioContext, ChangBits } from "./app.context.js";
import { LrcAudio } from "./audio.js";
import { toastPubSub } from "./toast.js";

export const Footer: React.FC = () => {
    const { prefState, lang } = useContext(appContext, ChangBits.lang | ChangBits.builtInAudio);
    const keyBindings = useKeyBindings();
    const audio = useAudio();
    const audioElRef = useContext(AudioContext)!;

    const [audioSrc, setAudioSrc] = useReducer(
        (oldSrc: string, newSrc: string) => {
            if (oldSrc.startsWith("blob:")) {
                URL.revokeObjectURL(oldSrc);
            }
            return newSrc;
        },
        "",
    );
    const fallbackAudioUrlRef = useRef("");

    useEffect(() => {
        function onKeydown(ev: KeyboardEvent) {
            if (isKeyboardElement(ev.target)) {
                return;
            }

            if (!audio.src) {
                return;
            }

            const action = getMatchedAction(ev, keyBindings);

            switch (action) {
                case InputAction.SeekBackward:
                    ev.preventDefault();
                    audio.step(ev, -5);
                    break;
                case InputAction.SeekForward:
                    ev.preventDefault();
                    audio.step(ev, 5);
                    break;
                case InputAction.ResetRate:
                    ev.preventDefault();
                    audio.playbackRate = 1;
                    break;
                case InputAction.IncreaseRate: {
                    ev.preventDefault();
                    const rate = audio.playbackRate;
                    audio.playbackRate = Math.exp(Math.min(Math.log(rate) + 0.2, 1));
                    break;
                }
                case InputAction.DecreaseRate: {
                    ev.preventDefault();
                    const rate = audio.playbackRate;
                    audio.playbackRate = Math.exp(Math.max(Math.log(rate) - 0.2, -1));
                    break;
                }
                case InputAction.TogglePlay:
                    ev.preventDefault();
                    audio.toggle();
                    break;
            }
        }
        document.addEventListener("keydown", onKeydown);

        return () => document.removeEventListener("keydown", onKeydown);
    }, [keyBindings, audio]);

    useEffect(() => {
        const onProjectAudio = (ev: Event) => {
            const detail = (ev as CustomEvent<ProjectAudioLoadDetail>).detail;
            if (detail?.file) {
                fallbackAudioUrlRef.current = "";
                sessionStorage.removeItem(SSK.audioSrc);
                receiveFile(detail.file, setAudioSrc, lang);
                return;
            }
            if (detail?.url) {
                fallbackAudioUrlRef.current = detail.fallbackUrl || "";
                sessionStorage.setItem(SSK.audioSrc, detail.url);
                setAudioSrc(detail.url);
            }
        };
        window.addEventListener(LOAD_PROJECT_AUDIO_EVENT, onProjectAudio as EventListener);
        return () => window.removeEventListener(LOAD_PROJECT_AUDIO_EVENT, onProjectAudio as EventListener);
    }, [lang]);

    useEffect(() => {
        const handler = () => {
            if (!document.hidden) {
                currentTimePubSub.pub(audio.currentTime);
                audioStatePubSub.pub({
                    type: AudioActionType.pause,
                    payload: audio.paused,
                });
            }
        };
        document.addEventListener("visibilitychange", handler);
        return () => document.removeEventListener("visibilitychange", handler);
    }, [audio]);

    const rafId = useRef(0);

    const onAudioLoadedMetadata = useCallback(() => {
        fallbackAudioUrlRef.current = "";
        cancelAnimationFrame(rafId.current);
        audioStatePubSub.pub({
            type: AudioActionType.getDuration,
            payload: audio.duration,
        });
        toastPubSub.pub({
            type: "success",
            text: lang.notify.audioLoaded,
        });
    }, [lang, audio]);

    const syncCurrentTime = useCallback(() => {
        currentTimePubSub.pub(audio.currentTime);
        rafId.current = requestAnimationFrame(syncCurrentTime);
    }, [audio]);

    const onAudioPlay = useCallback(() => {
        rafId.current = requestAnimationFrame(syncCurrentTime);
        audioStatePubSub.pub({
            type: AudioActionType.pause,
            payload: false,
        });
    }, [syncCurrentTime]);

    const onAudioPause = useCallback(() => {
        cancelAnimationFrame(rafId.current);
        audioStatePubSub.pub({
            type: AudioActionType.pause,
            payload: true,
        });
    }, []);

    const onAudioEnded = useCallback(() => {
        cancelAnimationFrame(rafId.current);
        audioStatePubSub.pub({
            type: AudioActionType.pause,
            payload: true,
        });
    }, []);

    const onAudioTimeUpdate = useCallback(() => {
        if (audio.paused) {
            currentTimePubSub.pub(audio.currentTime);
        }
    }, [audio]);

    const onAudioRateChange = useCallback(() => {
        audioStatePubSub.pub({
            type: AudioActionType.rateChange,
            payload: audio.playbackRate,
        });
    }, [audio]);

    const onAudioError = useCallback(
        (ev: React.SyntheticEvent<HTMLAudioElement>) => {
            const fallbackUrl = fallbackAudioUrlRef.current;
            const fallbackHref = fallbackUrl ? new URL(fallbackUrl, window.location.href).href : "";
            if (fallbackUrl && audio.current?.src !== fallbackHref) {
                fallbackAudioUrlRef.current = "";
                sessionStorage.setItem(SSK.audioSrc, fallbackUrl);
                setAudioSrc(fallbackUrl);
                return;
            }
            const el = ev.target as HTMLAudioElement;
            const error = el.error!;
            const message = lang.audio.error[error.code] || error.message || lang.audio.error[0];
            toastPubSub.pub({
                type: "warning",
                text: message,
            });
        },
        [lang, audio],
    );

    return (
        <footer className="app-footer">
            <audio
                ref={audioElRef}
                src={audioSrc || undefined}
                controls={prefState.builtInAudio}
                hidden={!prefState.builtInAudio}
                preload="metadata"
                onLoadedMetadata={onAudioLoadedMetadata}
                onPlay={onAudioPlay}
                onPause={onAudioPause}
                onEnded={onAudioEnded}
                onTimeUpdate={onAudioTimeUpdate}
                onRateChange={onAudioRateChange}
                onError={onAudioError}
            />
            {prefState.builtInAudio || <LrcAudio lang={lang} />}
        </footer>
    );
};

type TsetAudioSrc = (src: string) => void;

function audioImportErrorText(error: Error, lang: { ui: { unsupportedAudioFile: string; audioDecodeWorkerFailed: string } }): string {
    if (error.message === AUDIO_UNSUPPORTED_ERROR) return lang.ui.unsupportedAudioFile;
    if (error.message === AUDIO_DECODE_WORKER_ERROR) return lang.ui.audioDecodeWorkerFailed;
    return error.message;
}

const receiveFile = (file: File, setAudioSrc: TsetAudioSrc, lang: { ui: { unsupportedAudioFile: string; audioDecodeWorkerFailed: string } }): void => {
    void prepareAudioFile(file)
        .then(({ file: prepared }) => {
            setAudioSrc(URL.createObjectURL(prepared));
        })
        .catch((error: Error) => {
            toastPubSub.pub({
                type: "warning",
                text: audioImportErrorText(error, lang),
            });
        });
};
