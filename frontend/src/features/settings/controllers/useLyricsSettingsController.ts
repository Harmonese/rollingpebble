import type { RuntimeSettings } from "../../../shared/api/types.js";
import type { SettingsControllerContext } from "./settingsControllerUtils.js";
import { saveSettingsPatch } from "./settingsControllerUtils.js";

export function useLyricsSettingsController(options: SettingsControllerContext & {
    recentProjectsLimit: string;
    setRecentProjectsLimit: (value: string) => void;
    audioRegex: string;
    setAudioRegexEnabled: (value: boolean) => void;
    setAutoFillLibrary: (value: boolean) => void;
    setEditorWriteMetadataTags: (value: boolean) => void;
}) {
    const {
        audioRegex,
        lang,
        recentProjectsLimit,
        refresh,
        setAudioRegexEnabled,
        setAutoFillLibrary,
        setBusy,
        setEditorWriteMetadataTags,
        setMessage,
        setRecentProjectsLimit,
    } = options;
    const t = lang.settings;
    const context = { lang, refresh, setBusy, setMessage };

    const saveRecentProjectsLimit = () => {
        const parsed = Number(recentProjectsLimit);
        const value = Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.round(parsed)) : 8;
        setRecentProjectsLimit(String(value));
        void saveSettingsPatch(context, { recent_projects_limit: value }, t.messages.projectLimitSaved);
    };

    const saveAudioRegexEnabled = (checked: boolean) => {
        setAudioRegexEnabled(checked);
        void saveSettingsPatch(context, { audio_filename_regex_enabled: checked });
    };

    const saveAudioRegex = () => {
        void saveSettingsPatch(context, { audio_filename_regex: audioRegex }, t.messages.regexSaved);
    };

    const saveAutoFillLibrary = (checked: boolean) => {
        setAutoFillLibrary(checked);
        void saveSettingsPatch(context, { auto_fill_lyrics_library_from_project_metadata: checked });
    };

    const saveEditorWriteMetadataTags = (checked: boolean) => {
        setEditorWriteMetadataTags(checked);
        void saveSettingsPatch(context, { editor_write_metadata_tags: checked }, t.messages.metadataTagSaved);
    };

    const loadLyricsSettings = (settings: RuntimeSettings) => {
        setAutoFillLibrary(settings.auto_fill_lyrics_library_from_project_metadata);
        setEditorWriteMetadataTags(settings.editor_write_metadata_tags);
    };

    return {
        loadLyricsSettings,
        saveAudioRegex,
        saveAudioRegexEnabled,
        saveAutoFillLibrary,
        saveEditorWriteMetadataTags,
        saveRecentProjectsLimit,
    };
}
