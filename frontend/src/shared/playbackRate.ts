export const MIN_PLAYBACK_RATE = 1 / 3;
export const MAX_PLAYBACK_RATE = 3;
export const PLAYBACK_LOG_LIMIT = Math.log(3);
export const clampPlaybackRate = (rate: number): number =>
    Number.isFinite(rate) ? Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, rate)) : 1;
export const playbackRateFromLog = (value: number): number =>
    value <= -PLAYBACK_LOG_LIMIT
        ? MIN_PLAYBACK_RATE
        : value >= PLAYBACK_LOG_LIMIT
        ? MAX_PLAYBACK_RATE
        : clampPlaybackRate(Math.exp(value));
export const playbackRateToLog = (rate: number): number => Math.log(clampPlaybackRate(rate));
export const stepPlaybackRate = (rate: number, direction: -1 | 1): number =>
    playbackRateFromLog(playbackRateToLog(rate) + direction * 0.2);
