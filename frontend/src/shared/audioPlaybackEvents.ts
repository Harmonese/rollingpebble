import { createPubSub } from "../utils/pubsub.js";

export const enum AudioActionType {
    pause,
    getDuration,
    rateChange,
}

export type AudioState =
    | {
        type: AudioActionType.pause;
        payload: boolean;
    }
    | {
        type: AudioActionType.getDuration;
        payload: number;
    }
    | {
        type: AudioActionType.rateChange;
        payload: number;
    };

export const audioStatePubSub = createPubSub<AudioState>();
export const currentTimePubSub = createPubSub<number>();
