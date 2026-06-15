import { hasLyricContent } from "../../shared/lrc.js";
import { includesStage } from "./autoTimingOptions.js";

export type AutoTimingInputState = {
    ready: boolean;
    audioReady: boolean;
    lyricsReady: boolean;
    reason: string;
};

export function computeAutoTimingInputState(
    project: { audio_path?: string | null } | null,
    plainLyrics: string,
    syncedLyrics: string,
    stages: string,
    messages: { noProject: string; noAudio: string; noLyrics: string; ready: string },
): AutoTimingInputState {
    const needsAudio = includesStage(stages, "s") || includesStage(stages, "f") || includesStage(stages, "t");
    const needsLyrics = includesStage(stages, "p");
    const audioReady = !needsAudio || Boolean(project?.audio_path);
    const lyricsReady = !needsLyrics || hasLyricContent(plainLyrics) || hasLyricContent(syncedLyrics);
    if (!project) {
        return { ready: false, audioReady, lyricsReady, reason: messages.noProject };
    }
    if (!audioReady) {
        return { ready: false, audioReady, lyricsReady, reason: messages.noAudio };
    }
    if (!lyricsReady) {
        return { ready: false, audioReady, lyricsReady, reason: messages.noLyrics };
    }
    return { ready: true, audioReady, lyricsReady, reason: messages.ready };
}
