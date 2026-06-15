import { useCallback, useContext, useEffect, useState } from "react";
import { appContext, AppContextBits } from "../../shared/appContext.js";
import { useAutoTimingState } from "../../domain/auto-timing/useAutoTimingState.js";
import { useMessage } from "../../hooks/useMessage.js";
import { autoRollerRuntime } from "../../shared/api/autoTiming.js";
import { backendMessageText } from "../../shared/api/request.js";
import { resetSettingsDefaults } from "../../shared/api/settings.js";
import type { AutoRollerRuntime } from "../../shared/api/types.js";
import { notifySettingsUpdated } from "../../shared/settingsEvents.js";
import { Message } from "../../ui/Message.js";
import { Modal } from "../../ui/Modal.js";
import { toastPubSub } from "../../ui/Toast.js";
import { useAutoTimingRuntimeController } from "./controllers/useAutoTimingRuntimeController.js";
import { useLyricsSettingsController } from "./controllers/useLyricsSettingsController.js";
import { usePublishingSettingsController } from "./controllers/usePublishingSettingsController.js";
import { useStorageSettingsController } from "./controllers/useStorageSettingsController.js";
import { useWorkspaceSettingsController } from "./controllers/useWorkspaceSettingsController.js";
import {
    AutoTimingSettingsSection,
    LyricsSettingsSection,
    type Profile,
    PublishingSettingsSection,
    ResetSettingsSection,
    type SettingsSectionId,
    settingsSectionIds,
    StorageSettingsSection,
    WorkspaceSettingsSection,
} from "./SettingsSections.js";

export const SettingsPanel: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const [activeSection, setActiveSection] = useState<SettingsSectionId>("workspace");
    const [runtime, setRuntime] = useState<AutoRollerRuntime | null>(null);
    const [profile, setProfile] = useState<Profile>("auto");
    const [autoFillLibrary, setAutoFillLibrary] = useState(true);
    const [editorWriteMetadataTags, setEditorWriteMetadataTags] = useState(true);
    const [uploadDerivePlain, setUploadDerivePlain] = useState(true);
    const [audioRegexEnabled, setAudioRegexEnabled] = useState(false);
    const [audioRegex, setAudioRegex] = useState("");
    const [recentProjectsLimit, setRecentProjectsLimit] = useState("8");
    const [projectAutoDeleteDays, setProjectAutoDeleteDays] = useState("0");
    const [autoTimingLoaded, setAutoTimingLoaded] = useState(false);
    const [settingsLoadKey, setSettingsLoadKey] = useState(0);
    const [busy, setBusy] = useState(false);
    const [message, setMessage, , messageFading, messageType, messageKey] = useMessage();
    const { prefState, prefDispatch, lang } = useContext(appContext, AppContextBits.prefState | AppContextBits.lang);
    const at = useAutoTimingState();
    const loadAutoTimingSettings = at.loadFromSettings;
    const t = lang.settings;
    const u = lang.ui;

    const trOpt = (key: string) => (lang.optionLabels as Record<string, string | undefined>)?.[key] || key;
    const tl = (key: string): string => {
        const storageLabels = lang.storageLabels as Record<string, string | undefined>;
        const storageReasons = lang.storageReasons as Record<string, string | undefined>;
        if (key.startsWith("storage_label.")) return storageLabels?.[key.slice(14)] || key;
        if (key.startsWith("storage_reason.")) return storageReasons?.[key.slice(15)] || key;
        return storageLabels?.[key] || key;
    };

    const refresh = useCallback(async (notify = false) => {
        try {
            setAutoTimingLoaded(false);
            const data = await autoRollerRuntime();
            const settings = data.settings;
            setRuntime(data);
            setProfile(settings.auto_roller_profile);
            setAutoFillLibrary(settings.auto_fill_lyrics_library_from_project_metadata);
            setEditorWriteMetadataTags(settings.editor_write_metadata_tags);
            setUploadDerivePlain(settings.upload_derive_plain_from_synced);
            setAudioRegexEnabled(settings.audio_filename_regex_enabled || false);
            setAudioRegex(settings.audio_filename_regex || "");
            setRecentProjectsLimit(String(settings.recent_projects_limit || 8));
            setProjectAutoDeleteDays(String(settings.project_auto_delete_days || 0));
            loadAutoTimingSettings(settings);
            setSettingsLoadKey((current) => current + 1);
            window.setTimeout(() => setAutoTimingLoaded(true), 0);
            if (notify) toastPubSub.pub({ type: "success", text: t.messages.statusRefreshed });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        }
    }, [lang.backendMessages, loadAutoTimingSettings, setMessage, t.messages.statusRefreshed]);

    const autoTimingController = useAutoTimingRuntimeController({
        at,
        autoTimingLoaded,
        lang,
        open,
        profile,
        refresh,
        settingsLoadKey,
        setBusy,
        setMessage,
        setProfile,
    });

    const workspaceController = useWorkspaceSettingsController({
        lang,
        prefDispatch,
        prefState,
        setBusy,
        setMessage,
    });

    const lyricsController = useLyricsSettingsController({
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
    });

    const publishingController = usePublishingSettingsController({
        lang,
        refresh,
        setBusy,
        setMessage,
        setUploadDerivePlain,
    });

    const storageController = useStorageSettingsController({
        lang,
        projectAutoDeleteDays,
        refresh,
        refreshRuntime: refresh,
        setBusy,
        setMessage,
        setProjectAutoDeleteDays,
        tl,
    });
    const refreshStorage = storageController.refreshStorage;

    useEffect(() => {
        if (open) {
            void refresh();
            void refreshStorage();
        }
    }, [open, refresh, refreshStorage]);

    const resetDefaults = async () => {
        if (!window.confirm(u.resetConfirm)) return;
        setBusy(true);
        setMessage(t.messages.resetting, "info");
        try {
            await resetSettingsDefaults();
            notifySettingsUpdated();
            await refresh();
            setMessage("");
            toastPubSub.pub({ type: "success", text: t.messages.resetDone });
        } catch (error) {
            setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            setBusy(false);
        }
    };

    const sectionLabels: Record<SettingsSectionId, string> = t.sections;

    return (
        <Modal
            open={open}
            onClose={onClose}
            ariaLabel={t.title}
            closeLabel={t.close}
            modalClassName="settings-modal"
        >
            <div className="about-header settings-header">
                <h2>{t.title}</h2>
                <button type="button" onClick={onClose}>{t.close}</button>
            </div>

            <div className="settings-layout">
                <nav className="settings-nav" aria-label={t.title}>
                    {settingsSectionIds.map((sectionId) => (
                        <button
                            key={sectionId}
                            type="button"
                            className={`settings-nav-item${activeSection === sectionId ? " active" : ""}`}
                            aria-current={activeSection === sectionId ? "page" : undefined}
                            onClick={() => setActiveSection(sectionId)}
                        >
                            {sectionLabels[sectionId]}
                        </button>
                    ))}
                </nav>
                <div className="settings-content">
                    {activeSection === "workspace" && (
                        <WorkspaceSettingsSection
                            title={sectionLabels.workspace}
                            t={t}
                            prefState={prefState}
                            prefDispatch={prefDispatch}
                            hexInput={workspaceController.hexInput}
                            setHexInput={workspaceController.setHexInput}
                            busy={busy}
                            bgInputRef={workspaceController.bgInputRef}
                            onBgUpload={workspaceController.onBgUpload}
                            resetBg={() => void workspaceController.resetBg()}
                            resetDisplayPrefs={workspaceController.resetDisplayPrefs}
                        />
                    )}
                    {activeSection === "lyrics" && (
                        <LyricsSettingsSection
                            title={sectionLabels.lyrics}
                            t={t}
                            prefState={prefState}
                            prefDispatch={prefDispatch}
                            busy={busy}
                            recentProjectsLimit={recentProjectsLimit}
                            setRecentProjectsLimit={setRecentProjectsLimit}
                            saveRecentProjectsLimit={lyricsController.saveRecentProjectsLimit}
                            audioRegexEnabled={audioRegexEnabled}
                            audioRegex={audioRegex}
                            setAudioRegex={setAudioRegex}
                            setAudioRegexEnabled={setAudioRegexEnabled}
                            saveAudioRegexEnabled={lyricsController.saveAudioRegexEnabled}
                            saveAudioRegex={lyricsController.saveAudioRegex}
                            autoFillLibrary={autoFillLibrary}
                            saveAutoFillLibrary={lyricsController.saveAutoFillLibrary}
                            editorWriteMetadataTags={editorWriteMetadataTags}
                            saveEditorWriteMetadataTags={lyricsController.saveEditorWriteMetadataTags}
                        />
                    )}
                    {activeSection === "autoTiming" && (
                        <AutoTimingSettingsSection
                            title={sectionLabels.autoTiming}
                            lang={lang}
                            t={t}
                            u={u}
                            profile={profile}
                            busy={busy}
                            runtimeJobRunning={autoTimingController.runtimeJobRunning}
                            runtime={runtime}
                            saveProfile={(value) => void autoTimingController.saveProfile(value)}
                            runDoctor={() => void autoTimingController.runDoctor()}
                            runInstall={() => void autoTimingController.runInstall()}
                            runUpgrade={() => void autoTimingController.runUpgrade()}
                            runCacheModel={() => void autoTimingController.runCacheModel()}
                            copyDiagnostics={() => void autoTimingController.copyDiagnostics(runtime)}
                            refresh={(notify) => void refresh(notify)}
                            cancelRuntimeJob={() => void autoTimingController.cancelRuntimeJob()}
                            runtimeError={autoTimingController.runtimeError}
                            job={autoTimingController.job}
                            runtimeJobElapsed={autoTimingController.runtimeJobElapsed}
                            runtimeJobLastOutput={autoTimingController.runtimeJobLastOutput}
                            at={at}
                            trOpt={trOpt}
                        />
                    )}
                    {activeSection === "publishing" && (
                        <PublishingSettingsSection
                            title={sectionLabels.publishing}
                            t={t}
                            busy={busy}
                            uploadDerivePlain={uploadDerivePlain}
                            saveUploadDerivePlain={publishingController.saveUploadDerivePlain}
                        />
                    )}
                    {activeSection === "storage" && (
                        <StorageSettingsSection
                            title={sectionLabels.storage}
                            t={t}
                            u={u}
                            runtime={runtime}
                            trOpt={trOpt}
                            tl={tl}
                            storageUsage={storageController.storageUsage}
                            storageBusy={storageController.storageBusy}
                            storageTargetPaths={storageController.storageTargetPaths}
                            setStorageTargetPaths={storageController.setStorageTargetPaths}
                            storageOlderThanDays={storageController.storageOlderThanDays}
                            setStorageOlderThanDays={storageController.setStorageOlderThanDays}
                            projectAutoDeleteDays={projectAutoDeleteDays}
                            setProjectAutoDeleteDays={setProjectAutoDeleteDays}
                            saveProjectAutoDeleteDays={storageController.saveProjectAutoDeleteDays}
                            safeCleanupAvailable={storageController.safeCleanupAvailable}
                            storageProjects={storageController.storageProjects}
                            allStorageProjectIds={storageController.allStorageProjectIds}
                            allIntermediateProjectIds={storageController.allIntermediateProjectIds}
                            storageModels={storageController.storageModels}
                            storageRuntimes={storageController.storageRuntimes}
                            storageOtherItems={storageController.storageOtherItems}
                            openStorageFolder={() => void storageController.openStorageFolder()}
                            browseStorageRoot={(root) => void storageController.browseStorageRoot(root)}
                            migrateStorageRoot={(root) => void storageController.migrateStorageRoot(root)}
                            openModelFolder={(modelId) => void storageController.openModelFolder(modelId)}
                            openRuntimeFolder={(runtimeId) => void storageController.openRuntimeFolder(runtimeId)}
                            openOtherFolder={(relativePath) => void storageController.openOtherFolder(relativePath)}
                            runStorageCleanupDirect={(targets, options) =>
                                void storageController.runStorageCleanupDirect(targets, options)}
                        />
                    )}
                    {activeSection === "reset" && (
                        <ResetSettingsSection
                            title={sectionLabels.reset}
                            t={t}
                            busy={busy}
                            resetDefaults={() => void resetDefaults()}
                        />
                    )}
                </div>
            </div>

            <Message message={message} type={messageType} fading={messageFading} messageKey={messageKey} />
        </Modal>
    );
};
