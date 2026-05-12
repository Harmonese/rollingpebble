import { useCallback, useEffect, useState } from "react";
import { api, type AutoRollerRuntime, type JobModel } from "../../shared/api.js";
import { notifySettingsUpdated } from "../../shared/settingsEvents.js";

type Profile = "auto" | "cpu" | "cu124";
type HfXet = "auto" | "on" | "off";

function textFromOptionalNumber(value?: number | null): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function optionalNumber(value: string): number | null {
    const text = value.trim();
    if (!text) return null;
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("Timeouts and worker counts must be positive numbers.");
    }
    return parsed;
}

export const SettingsPanel: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const [runtime, setRuntime] = useState<AutoRollerRuntime | null>(null);
    const [profile, setProfile] = useState<Profile>("auto");
    const [autoFillLibrary, setAutoFillLibrary] = useState(true);
    const [autoCleanupImportedLyrics, setAutoCleanupImportedLyrics] = useState(false);
    const [uploadDerivePlain, setUploadDerivePlain] = useState(true);
    const [modelStore, setModelStore] = useState("");
    const [defaultLocalOnly, setDefaultLocalOnly] = useState(false);
    const [hfXet, setHfXet] = useState<HfXet>("auto");
    const [hfProxy, setHfProxy] = useState("");
    const [hfEtagTimeout, setHfEtagTimeout] = useState("");
    const [hfDownloadTimeout, setHfDownloadTimeout] = useState("");
    const [hfMaxWorkers, setHfMaxWorkers] = useState("");
    const [job, setJob] = useState<JobModel | null>(null);
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const data = await api.autoRollerRuntime();
            setRuntime(data);
            setProfile(data.settings.auto_roller_profile);
            setAutoFillLibrary(data.settings.auto_fill_lyrics_library_from_project_metadata);
            setAutoCleanupImportedLyrics(data.settings.auto_cleanup_imported_lyrics);
            setUploadDerivePlain(data.settings.upload_derive_plain_from_synced);
            setModelStore(data.settings.auto_timing_model_store || "");
            setDefaultLocalOnly(data.settings.auto_timing_local_files_only_default);
            setHfXet(data.settings.auto_timing_hf_xet || "auto");
            setHfProxy(data.settings.auto_timing_hf_proxy || "");
            setHfEtagTimeout(textFromOptionalNumber(data.settings.auto_timing_hf_etag_timeout));
            setHfDownloadTimeout(textFromOptionalNumber(data.settings.auto_timing_hf_download_timeout));
            setHfMaxWorkers(textFromOptionalNumber(data.settings.auto_timing_hf_max_workers));
        } catch (error) {
            setMessage((error as Error).message);
        }
    }, []);

    useEffect(() => {
        if (open) void refresh();
    }, [open, refresh]);

    useEffect(() => {
        if (!job || !["queued", "running"].includes(job.status)) return;
        const timer = window.setInterval(async () => {
            try {
                const next = await api.getJob(job.job_id);
                setJob(next);
                if (["succeeded", "failed", "canceled"].includes(next.status)) {
                    void refresh();
                }
            } catch (error) {
                setMessage((error as Error).message);
            }
        }, 1400);
        return () => window.clearInterval(timer);
    }, [job, refresh]);

    if (!open) return null;

    const savePatch = async (payload: Record<string, unknown>, success = "Settings saved.") => {
        setBusy(true);
        setMessage("Saving settings...");
        try {
            await api.updateSettings(payload);
            notifySettingsUpdated();
            await refresh();
            setMessage(success);
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const saveProfile = async (value: Profile) => {
        setProfile(value);
        await savePatch({ auto_roller_profile: value });
    };

    const saveDownloadDefaults = async () => {
        try {
            await savePatch({
                auto_timing_model_store: modelStore.trim(),
                auto_timing_local_files_only_default: defaultLocalOnly,
                auto_timing_hf_xet: hfXet,
                auto_timing_hf_proxy: hfProxy.trim(),
                auto_timing_hf_etag_timeout: optionalNumber(hfEtagTimeout),
                auto_timing_hf_download_timeout: optionalNumber(hfDownloadTimeout),
                auto_timing_hf_max_workers: optionalNumber(hfMaxWorkers),
            }, "Model download defaults saved.");
        } catch (error) {
            setMessage((error as Error).message);
        }
    };

    const applySafeDefaults = () => {
        setDefaultLocalOnly(false);
        setHfXet("off");
        setHfEtagTimeout("120");
        setHfDownloadTimeout("300");
        setHfMaxWorkers("1");
        setMessage("Safe download defaults are staged. Click Save model download defaults to apply them.");
    };


    const browseModelStore = async () => {
        setBusy(true);
        setMessage("Opening folder picker...");
        try {
            const result = await api.selectLocalPath({
                mode: "directory",
                title: "Select model store folder",
                initial_path: modelStore || runtime?.model_store || null,
            });
            if (!result.canceled && result.path) {
                setModelStore(result.path);
                setMessage("Model store selected. Click Save model download defaults to apply it.");
            } else {
                setMessage("Folder selection canceled.");
            }
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const runDoctor = async () => {
        setBusy(true);
        setMessage("Starting runtime check...");
        try {
            const created = await api.runAutoRollerDoctor();
            setJob(created);
            setMessage(`Started ${created.job_id}`);
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const runInstall = async (dryRun = false) => {
        setBusy(true);
        setMessage(dryRun ? "Preparing install dry run..." : "Starting install/repair...");
        try {
            const created = await api.runAutoRollerInstall({ profile, dry_run: dryRun });
            setJob(created);
            setMessage(`Started ${created.job_id}`);
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const copyDiagnostics = async () => {
        const text = JSON.stringify({ runtime, job }, null, 2);
        await navigator.clipboard?.writeText(text);
        setMessage("Diagnostics copied.");
    };

    return (
        <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings">
            <button className="settings-backdrop" type="button" onClick={onClose} aria-label="Close settings" />
            <aside className="settings-drawer">
                <div className="settings-header">
                    <div>
                        <h2>Settings</h2>
                        <p>Local runtime and app configuration.</p>
                    </div>
                    <button type="button" onClick={onClose}>Close</button>
                </div>

                <section className="settings-section">
                    <h3>General</h3>
                    <div className="roller-kv">
                        <b>App mode</b><span>Local WebUI</span>
                        <b>Backend</b><span>http://127.0.0.1:6789</span>
                        <b>Frontend</b><span>Vite dev server on http://127.0.0.1:5173</span>
                    </div>
                    <label className="settings-check-row">
                        <input
                            type="checkbox"
                            checked={autoFillLibrary}
                            disabled={busy}
                            onChange={(ev) => {
                                setAutoFillLibrary(ev.currentTarget.checked);
                                void savePatch({ auto_fill_lyrics_library_from_project_metadata: ev.currentTarget.checked });
                            }}
                        />
                        <span>
                            <b>Auto-fill Lyrics Import from project metadata</b>
                            <small>Fill import fields from audio tags when a project is loaded.</small>
                        </span>
                    </label>
                    <label className="settings-check-row">
                        <input
                            type="checkbox"
                            checked={autoCleanupImportedLyrics}
                            disabled={busy}
                            onChange={(ev) => {
                                setAutoCleanupImportedLyrics(ev.currentTarget.checked);
                                void savePatch({ auto_cleanup_imported_lyrics: ev.currentTarget.checked });
                            }}
                        />
                        <span>
                            <b>Auto-clean imported LRC</b>
                            <small>Clean imported synced lyrics before placing them into the editor.</small>
                        </span>
                    </label>
                </section>

                <section className="settings-section">
                    <h3>Upload</h3>
                    <label className="settings-check-row">
                        <input
                            type="checkbox"
                            checked={uploadDerivePlain}
                            disabled={busy}
                            onChange={(ev) => {
                                setUploadDerivePlain(ev.currentTarget.checked);
                                void savePatch({ upload_derive_plain_from_synced: ev.currentTarget.checked });
                            }}
                        />
                        <span>
                            <b>Derive plain lyrics from synced lyrics</b>
                            <small>Submit timestamp-stripped plain lyrics when uploading synced LRC.</small>
                        </span>
                    </label>
                </section>

                <section className="settings-section">
                    <h3>Auto Timing Runtime</h3>
                    <div className="roller-kv">
                        <b>Engine</b><span>{runtime?.engine || "py-roller"}</span>
                        <b>Status</b><span>{runtime ? (runtime.available ? "available" : "not available") : "loading"}</span>
                        <b>Version</b><span>{runtime?.version || "unknown"}</span>
                        <b>Command</b><span>{runtime?.cli_path || runtime?.detail || "not found"}</span>
                        <b>Python</b><span>{runtime?.python_executable || "unknown"}</span>
                        <b>Data dir</b><span>{runtime?.data_dir || "unknown"}</span>
                        <b>Model store</b><span>{modelStore || runtime?.model_store || "unknown"}</span>
                        <b>Last check</b><span>{runtime?.settings.last_doctor_status || "not run"} {runtime?.settings.last_doctor_at ? `· ${runtime.settings.last_doctor_at}` : ""}</span>
                        <b>Last install</b><span>{runtime?.settings.last_install_profile || "not run"} {runtime?.settings.last_install_at ? `· ${runtime.settings.last_install_at}` : ""}</span>
                    </div>

                    <div className="roller-form settings-profile-row">
                        <label>Install profile
                            <select value={profile} disabled={busy} onChange={(ev) => void saveProfile(ev.target.value as Profile)}>
                                <option value="auto">Auto</option>
                                <option value="cpu">CPU only</option>
                                <option value="cu124">CUDA 12.4</option>
                            </select>
                        </label>
                    </div>

                    <div className="roller-section-title">Model download defaults</div>
                    <div className="roller-form two-col">
                        <label className="field-with-browse">Model store path
                            <span className="browse-row">
                                <input placeholder={runtime?.model_store || "default"} value={modelStore} onChange={(ev) => setModelStore(ev.target.value)} />
                                <button type="button" disabled={busy} onClick={browseModelStore}>Browse</button>
                            </span>
                        </label>
                        <label>HF XET / CAS
                            <select value={hfXet} onChange={(ev) => setHfXet(ev.target.value as HfXet)}>
                                <option value="auto">Auto</option>
                                <option value="off">Off, safer network path</option>
                                <option value="on">On</option>
                            </select>
                        </label>
                        <label>Proxy URL
                            <input placeholder="http://127.0.0.1:7890" value={hfProxy} onChange={(ev) => setHfProxy(ev.target.value)} />
                        </label>
                        <label>Max download workers
                            <input inputMode="numeric" placeholder="default" value={hfMaxWorkers} onChange={(ev) => setHfMaxWorkers(ev.target.value)} />
                        </label>
                        <label>Metadata timeout, seconds
                            <input inputMode="decimal" placeholder="default" value={hfEtagTimeout} onChange={(ev) => setHfEtagTimeout(ev.target.value)} />
                        </label>
                        <label>File download timeout, seconds
                            <input inputMode="decimal" placeholder="default" value={hfDownloadTimeout} onChange={(ev) => setHfDownloadTimeout(ev.target.value)} />
                        </label>
                        <label className="roller-checkbox">
                            Use local cache only by default
                            <input type="checkbox" checked={defaultLocalOnly} onChange={(ev) => setDefaultLocalOnly(ev.currentTarget.checked)} />
                        </label>
                    </div>
                    <div className="roller-actions">
                        <button type="button" disabled={busy} onClick={() => void saveDownloadDefaults()}>Save model download defaults</button>
                        <button type="button" disabled={busy} onClick={applySafeDefaults}>Use safe download defaults</button>
                    </div>

                    <div className="roller-actions">
                        <button type="button" disabled={busy} onClick={runDoctor}>Run runtime check</button>
                        <button type="button" disabled={busy} onClick={() => void runInstall(false)}>Install / repair</button>
                        <button type="button" disabled={busy} onClick={() => void runInstall(true)}>Dry run install</button>
                        <button type="button" onClick={copyDiagnostics}>Copy diagnostics</button>
                        <button type="button" onClick={refresh}>Refresh</button>
                    </div>
                    {message && <p className="roller-message">{message}</p>}
                    {job && (
                        <details open>
                            <summary>{job.kind} · {job.job_id} · {job.status}</summary>
                            <pre className="roller-log">{job.logs.join("\n") || job.command.join(" ")}</pre>
                        </details>
                    )}
                </section>

                <section className="settings-section">
                    <h3>About</h3>
                    <p className="roller-muted">lrc-roller is a local front-end workflow for lyrics lookup, automatic timing, manual editing, and publishing.</p>
                </section>
            </aside>
        </div>
    );
};
