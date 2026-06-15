import * as autoTimingApi from "./autoTiming.js";
import * as jobsApi from "./jobs.js";
import * as lyricsSourcesApi from "./lyricsSources.js";
import * as projectsApi from "./projects.js";
import * as settingsApi from "./settings.js";
import * as storageApi from "./storage.js";
import * as uploadApi from "./upload.js";

export * from "./autoTiming.js";
export * from "./jobs.js";
export * from "./lyricsSources.js";
export * from "./projects.js";
export * from "./request.js";
export * from "./settings.js";
export * from "./storage.js";
export * from "./types.js";
export * from "./upload.js";

export const api = {
    ...settingsApi,
    ...projectsApi,
    ...lyricsSourcesApi,
    ...autoTimingApi,
    ...jobsApi,
    ...uploadApi,
    ...storageApi,
};
