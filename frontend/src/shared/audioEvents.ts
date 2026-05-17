export const LOAD_PROJECT_AUDIO_EVENT = "rollingpebble:load-project-audio";

export type ProjectAudioLoadDetail =
    | { file: File; url?: never; fallbackUrl?: never }
    | { file?: never; url: string; fallbackUrl?: string };

export const loadProjectAudioForPlayback = (file: File): void => {
    window.dispatchEvent(new CustomEvent<ProjectAudioLoadDetail>(LOAD_PROJECT_AUDIO_EVENT, { detail: { file } }));
};

export const loadProjectAudioUrlForPlayback = (url: string, fallbackUrl?: string): void => {
    window.dispatchEvent(new CustomEvent<ProjectAudioLoadDetail>(LOAD_PROJECT_AUDIO_EVENT, { detail: { url, fallbackUrl } }));
};
