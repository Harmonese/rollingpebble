import { useEffect, useState } from "react";
import { api, type MetaModel, type ProjectModel, type UploadPlan } from "../../shared/api.js";
import { SETTINGS_UPDATED_EVENT } from "../../shared/settingsEvents.js";

export const UploadPanel: React.FC<{
    project: ProjectModel | null;
    plainLyrics: string;
    syncedLyrics: string;
    editorMeta: MetaModel;
    onProject: (project: ProjectModel, applyToEditor?: boolean) => void;
}> = ({ project, plainLyrics, syncedLyrics, editorMeta, onProject }) => {
    const [mode, setMode] = useState("auto");
    const [allowDerivedPlain, setAllowDerivedPlain] = useState(true);
    const [plan, setPlan] = useState<UploadPlan | null>(null);
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);

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

    const payload = () => ({
        mode,
        allow_derived_plain: allowDerivedPlain,
        metadata: editorMeta,
        plain_lyrics: plainLyrics,
        synced_lyrics: syncedLyrics,
    });

    const makePlan = async () => {
        if (!project) {
            setMessage("Create/import an audio project first.");
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
            setMessage(response.can_upload ? "Plan is ready." : "Plan has blocking warnings.");
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const runUpload = async () => {
        if (!project) return;
        setBusy(true);
        try {
            const response = await api.uploadRun(project.project_id, payload());
            setMessage(response.message);
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="roller-card">
            <h2>Upload</h2>
            <div className="roller-form">
                <label>Mode
                    <select value={mode} onChange={(ev) => setMode(ev.target.value)}>
                        <option value="auto">auto</option>
                        <option value="mixed">mixed</option>
                        <option value="synced">synced</option>
                        <option value="plain">plain</option>
                        <option value="instrumental">instrumental</option>
                    </select>
                </label>
            </div>
            <div className="roller-actions">
                <button type="button" disabled={busy || !project} onClick={makePlan}>Generate plan</button>
                <button type="button" disabled={busy || !project || !plan?.can_upload} onClick={runUpload}>Confirm upload</button>
            </div>
            {message && <p className="roller-message">{message}</p>}
            {plan && (
                <div className="roller-plan">
                    <div className="roller-kv">
                        <b>Can upload</b><span>{plan.can_upload ? "yes" : "no"}</span>
                        <b>Mode</b><span>{plan.mode}</span>
                        <b>Reason</b><span>{plan.reason}</span>
                        <b>Plain lines</b><span>{plan.plain_lines}</span>
                        <b>Synced lines</b><span>{plan.synced_lines}</span>
                    </div>
                    {plan.warnings.length > 0 && <p className="roller-warning">Warnings: {plan.warnings.join(", ")}</p>}
                    <pre className="roller-log">{JSON.stringify(plan.payload_preview, null, 2)}</pre>
                </div>
            )}
        </section>
    );
};
