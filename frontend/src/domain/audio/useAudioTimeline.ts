import { useEffect } from "react";
import { AudioActionType, audioStatePubSub, currentTimePubSub } from "../../shared/audioPlaybackEvents.js";

export { AudioActionType };

export function useAudioDurationEffect(onDuration: (duration: number) => void): void {
    useEffect(() => {
        const key = Symbol("AudioDurationEffect");
        return audioStatePubSub.sub(key, (data) => {
            if (data.type === AudioActionType.getDuration) {
                onDuration(data.payload);
            }
        });
    }, [onDuration]);
}

export function subscribeAudioState(
    key: symbol,
    listener: Parameters<typeof audioStatePubSub.sub>[1],
): () => void {
    return audioStatePubSub.sub(key, listener);
}

export function subscribeCurrentTime(key: symbol, listener: (time: number) => void): () => void {
    return currentTimePubSub.sub(key, listener);
}
