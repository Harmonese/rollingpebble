export const LOAD_PROJECT_AUDIO_EVENT = "lrc-roller:load-project-audio";

export type ProjectAudioLoadDetail =
    | { file: File; url?: never }
    | { file?: never; url: string };

export const loadProjectAudioForPlayback = (file: File): void => {
    window.dispatchEvent(new CustomEvent<ProjectAudioLoadDetail>(LOAD_PROJECT_AUDIO_EVENT, { detail: { file } }));
};

export const loadProjectAudioUrlForPlayback = (url: string): void => {
    window.dispatchEvent(new CustomEvent<ProjectAudioLoadDetail>(LOAD_PROJECT_AUDIO_EVENT, { detail: { url } }));
};
