import { useContext, useEffect, useState } from "react";
import { useMessage, type MessageType } from "../../hooks/useMessage.js";
import { toastPubSub } from "../../components/toast.js";
import { appContext, ChangBits } from "../../components/app.context.js";
import { api, type MetaModel, type ProjectModel, type UploadPlan } from "../../shared/api.js";
import { SETTINGS_UPDATED_EVENT } from "../../shared/settingsEvents.js";
import { NeteaseSearch } from "../shared/NeteaseSearch.js";
import type { NeteaseSearchRenderProps } from "../shared/NeteaseSearch.js";

type UploadDestination = "lrclib" | "netease";

export const UploadPanel: React.FC<{
    project: ProjectModel | null;
    plainLyrics: string;
    syncedLyrics: string;
    editorMeta: MetaModel;
    onProject: (project: ProjectModel, applyToEditor?: boolean) => void;
}> = ({ project, plainLyrics, syncedLyrics, editorMeta, onProject }) => {
    const [destination, setDestination] = useState<UploadDestination>("lrclib");
    const [mode, setMode] = useState("auto");
    const [allowDerivedPlain, setAllowDerivedPlain] = useState(true);
    const [plan, setPlan] = useState<UploadPlan | null>(null);
    const [message, setMessage, , messageFading, messageType] = useMessage();
    const { lang } = useContext(appContext, ChangBits.lang);
    const u = lang.ui;
    const [busy, setBusy] = useState(false);

    const showMessage = (text: string, type: MessageType, _duration?: number) => {
        toastPubSub.pub({ type, text });
    };

    useEffect(() => {
        const refreshSettings = async () => {
            try {
                const settings = await api.settings();
                setAllowDerivedPlain(settings.upload_derive_plain_from_synced);
            } catch {
                setAllowDerivedPlain(true);
            }
        };
        void refreshSettings();
        const onSettingsUpdated = () => void refreshSettings();
        window.addEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
        return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
    }, []);

    useEffect(() => { setPlan(null); }, [project?.project_id]);

    const payload = () => ({
        mode,
        allow_derived_plain: allowDerivedPlain,
        metadata: editorMeta,
        plain_lyrics: plainLyrics,
        synced_lyrics: syncedLyrics,
    });

    const makePlan = async () => {
        if (!project) {
            setMessage(u.noProject, "warning", 5000);
            return;
        }
        setBusy(true);
        try {
            const updated = await api.saveEditor(project.project_id, {
                plain_lyrics: plainLyrics,
                synced_lyrics: syncedLyrics,
                metadata: editorMeta,
            });
            onProject(updated, false);
            const response = await api.uploadPlan(project.project_id, payload());
            setPlan(response);
            setMessage(response.can_upload ? u.planReady : u.planWarnings, response.can_upload ? "success" : "warning", response.can_upload ? 4000 : 0);
        } catch (error) {
            setMessage((error as Error).message, "error");
        } finally {
            setBusy(false);
        }
    };

    const runUpload = async () => {
        if (!project) return;
        setBusy(true);
        try {
            const response = await api.uploadRun(project.project_id, payload());
            toastPubSub.pub({ type: "success", text: response.message });
        } catch (error) {
            setMessage((error as Error).message, "error");
        } finally {
            setBusy(false);
        }
    };

    const renderLrclibUpload = () => (
        <>
            <div className="roller-form">
                <label>{u.mode}
                    <select value={mode} onChange={(ev) => setMode(ev.target.value)}>
                        <option value="auto">Auto</option>
                        <option value="mixed">Mixed</option>
                        <option value="synced">Synced</option>
                        <option value="plain">Plain</option>
                        <option value="instrumental">Instrumental</option>
                    </select>
                </label>
            </div>
            <div className="roller-actions">
                <button type="button" disabled={busy || !project} onClick={makePlan}>{u.generatePlan}</button>
                <button type="button" disabled={busy || !project || !plan?.can_upload} onClick={runUpload}>{u.confirmUpload}</button>
            </div>
            {plan && (
                <div className="roller-plan">
                    <div className="roller-kv">
                        <b>{u.canUpload}</b><span>{plan.can_upload ? u.yes : u.no}</span>
                        <b>{u.mode}</b><span>{plan.mode}</span>
                        <b>{u.reason}</b><span>{plan.reason}</span>
                        <b>{u.plainLines}</b><span>{plan.plain_lines}</span>
                        <b>{u.syncedLines}</b><span>{plan.synced_lines}</span>
                    </div>
                    {plan.warnings.length > 0 && <p className="roller-warning">{u.warnings}: {plan.warnings.join(", ")}</p>}
                    <pre className="roller-log">{JSON.stringify(plan.payload_preview, null, 2)}</pre>
                </div>
            )}
        </>
    );

    const renderNeteaseUploadActions = ({ song }: NeteaseSearchRenderProps) => (
        <button type="button" onClick={() => window.open(song.wiki_url, "_blank", "noopener,noreferrer")}>{u.openWiki}</button>
    );

    const renderNeteaseUpload = () => (
        <NeteaseSearch
            defaultQuery=""
            meta={{ track: editorMeta.track || project?.metadata.track, artist: editorMeta.artist || project?.metadata.artist, album: editorMeta.album || project?.metadata.album }}
            onMessage={showMessage}
            renderResultActions={renderNeteaseUploadActions}
        />
    );

    return (
        <section className="roller-card">
            <h2>{u.uploadLyrics}</h2>
            <div className="library-strip" role="tablist" aria-label="Upload destinations">
                <button
                    className={`library-chip ${destination === "lrclib" ? "active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={destination === "lrclib"}
                    onClick={() => setDestination("lrclib")}
                >
                    {u.lrclib}
                </button>
                <button
                    className={`library-chip ${destination === "netease" ? "active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={destination === "netease"}
                    onClick={() => setDestination("netease")}
                >
                    {u.netease}
                </button>
            </div>
            {destination === "lrclib" ? renderLrclibUpload() : renderNeteaseUpload()}
            {message && <p className={`roller-message ${messageType}${messageFading ? " fading" : ""}`}>{message}</p>}
        </section>
    );
};
