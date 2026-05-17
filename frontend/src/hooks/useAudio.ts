import { useContext, useMemo } from "react";
import { AudioContext } from "../components/app.context.js";
import { guard } from "./useLrc.js";

export function useAudio() {
    const ref = useContext(AudioContext)!;
    return useMemo(() => ({
        get current() {
            return ref.current;
        },
        get src() {
            return ref.current?.src ?? "";
        },
        get duration() {
            return ref.current?.duration ?? 0;
        },
        get paused() {
            return ref.current?.paused ?? true;
        },
        get playbackRate() {
            return ref.current?.playbackRate ?? 1;
        },
        set playbackRate(rate: number) {
            if (ref.current) ref.current.playbackRate = rate;
        },
        get currentTime() {
            return ref.current?.currentTime ?? 0;
        },
        set currentTime(time: number) {
            if (ref.current?.duration) ref.current.currentTime = time;
        },
        step(
            ev: React.MouseEvent | React.KeyboardEvent | MouseEvent | KeyboardEvent,
            value: number,
            target?: number,
        ): number {
            if (target === undefined) target = ref.current?.currentTime ?? 0;
            if (ev.altKey) value *= 0.2;
            if (ev.shiftKey) value *= 0.5;
            const result = guard(value + target, 0, ref.current?.duration ?? 0);
            if (ref.current) ref.current.currentTime = result;
            return result;
        },
        toggle() {
            if (ref.current?.duration) {
                ref.current.paused ? ref.current.play() : ref.current.pause();
            }
        },
    }), []);
}
