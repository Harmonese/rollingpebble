import SSK from "#const/session_key.json" with { type: "json" };
import { useCallback, useContext, useEffect, useReducer, useRef } from "react";
import { useKeyBindings } from "../hooks/useKeyBindings.js";
import { prepareAudioFile } from "../shared/audioDecode.js";
import { LOAD_PROJECT_AUDIO_EVENT, type ProjectAudioLoadDetail } from "../shared/audioEvents.js";
import { AudioActionType, audioRef, audioStatePubSub, currentTimePubSub } from "../utils/audiomodule.js";
import { InputAction } from "../utils/input-action.js";
import { isKeyboardElement } from "../utils/is-keyboard-element.js";
import { getMatchedAction } from "../utils/keybindings.js";
import { appContext, ChangBits } from "./app.context.js";
import { LrcAudio } from "./audio.js";
import { toastPubSub } from "./toast.js";

export const Footer: React.FC = () => {
    const { prefState, lang } = useContext(appContext, ChangBits.lang | ChangBits.builtInAudio);
    const keyBindings = useKeyBindings();

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

            if (!audioRef.src) {
                return;
            }

            const action = getMatchedAction(ev, keyBindings);

            switch (action) {
                case InputAction.SeekBackward:
                    ev.preventDefault();
                    audioRef.step(ev, -5);
                    break;
                case InputAction.SeekForward:
                    ev.preventDefault();
                    audioRef.step(ev, 5);
                    break;
                case InputAction.ResetRate:
                    ev.preventDefault();
                    audioRef.playbackRate = 1;
                    break;
                case InputAction.IncreaseRate: {
                    ev.preventDefault();
                    const rate = audioRef.playbackRate;
                    audioRef.playbackRate = Math.exp(Math.min(Math.log(rate) + 0.2, 1));
                    break;
                }
                case InputAction.DecreaseRate: {
                    ev.preventDefault();
                    const rate = audioRef.playbackRate;
                    audioRef.playbackRate = Math.exp(Math.max(Math.log(rate) - 0.2, -1));
                    break;
                }
                case InputAction.TogglePlay:
                    ev.preventDefault();
                    audioRef.toggle();
                    break;
            }
        }
        document.addEventListener("keydown", onKeydown);

        return () => document.removeEventListener("keydown", onKeydown);
    }, [keyBindings]);

    useEffect(() => {
        const onProjectAudio = (ev: Event) => {
            const detail = (ev as CustomEvent<ProjectAudioLoadDetail>).detail;
            if (detail?.file) {
                fallbackAudioUrlRef.current = "";
                sessionStorage.removeItem(SSK.audioSrc);
                receiveFile(detail.file, setAudioSrc);
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
    }, []);

    const rafId = useRef(0);

    const onAudioLoadedMetadata = useCallback(() => {
        fallbackAudioUrlRef.current = "";
        cancelAnimationFrame(rafId.current);
        audioStatePubSub.pub({
            type: AudioActionType.getDuration,
            payload: audioRef.duration,
        });
        toastPubSub.pub({
            type: "success",
            text: lang.notify.audioLoaded,
        });
    }, [lang]);

    const syncCurrentTime = useCallback(() => {
        currentTimePubSub.pub(audioRef.currentTime);
        rafId.current = requestAnimationFrame(syncCurrentTime);
    }, []);

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
        if (audioRef.paused) {
            currentTimePubSub.pub(audioRef.currentTime);
        }
    }, []);

    const onAudioRateChange = useCallback(() => {
        audioStatePubSub.pub({
            type: AudioActionType.rateChange,
            payload: audioRef.playbackRate,
        });
    }, []);

    const onAudioError = useCallback(
        (ev: React.SyntheticEvent<HTMLAudioElement>) => {
            const fallbackUrl = fallbackAudioUrlRef.current;
            const fallbackHref = fallbackUrl ? new URL(fallbackUrl, window.location.href).href : "";
            if (fallbackUrl && audioRef.currentSrc !== fallbackHref) {
                fallbackAudioUrlRef.current = "";
                sessionStorage.setItem(SSK.audioSrc, fallbackUrl);
                setAudioSrc(fallbackUrl);
                return;
            }
            const audio = ev.target as HTMLAudioElement;
            const error = audio.error!;
            const message = lang.audio.error[error.code] || error.message || lang.audio.error[0];
            toastPubSub.pub({
                type: "warning",
                text: message,
            });
        },
        [lang],
    );

    return (
        <footer className="app-footer">
            <audio
                ref={audioRef}
                src={audioSrc}
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

const receiveFile = (file: File, setAudioSrc: TsetAudioSrc): void => {
    void prepareAudioFile(file)
        .then(({ file: prepared }) => {
            setAudioSrc(URL.createObjectURL(prepared));
        })
        .catch((error: Error) => {
            toastPubSub.pub({
                type: "warning",
                text: error.message,
            });
        });
};

// side effect
document.addEventListener("visibilitychange", () => {
    if (!audioRef.paused) {
        audioRef.toggle();
    }
});
