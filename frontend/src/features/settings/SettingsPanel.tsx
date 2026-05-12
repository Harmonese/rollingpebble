import { useCallback, useEffect, useState } from "react";
import { api, type AutoRollerRuntime, type JobModel } from "../../shared/api.js";
import { notifySettingsUpdated } from "../../shared/settingsEvents.js";
import {
    ALIGNER_BACKEND_OPTIONS,
    CLEANUP_OPTIONS,
    COMPUTE_TYPE_OPTIONS,
    DEMUCS_DEVICE_OPTIONS,
    DEMUCS_MODEL_OPTIONS,
    DEVICE_OPTIONS,
    FILTER_CHAIN_OPTIONS,
    HF_XET_OPTIONS,
    KARAOKE_TAG_OPTIONS,
    LANGUAGE_OPTIONS,
    LOG_LEVEL_OPTIONS,
    PARSER_ENCODING_OPTIONS,
    REPETITION_OPTIONS,
    SPACING_OPTIONS,
    SPLITTER_BACKEND_OPTIONS,
    STAGE_OPTIONS,
    WRITER_OPTIONS,
    defaultModelFor,
    isFasterWhisper,
    normalizeTranscriberBackend,
    transcriberBackendOptions,
    transcriberModelOptions,
    type Cleanup,
    type HfXet,
    type KaraokeTag,
    type Language,
    type LogLevel,
    type Repetition,
    type Spacing,
} from "../roller/autoTimingOptions.js";

type Profile = "auto" | "cpu" | "cu124";

function textFromOptionalNumber(value?: number | null): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function optionalNumber(value: string): number | null {
    const text = value.trim();
    if (!text) return null;
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("Numeric settings must be positive numbers.");
    }
    return parsed;
}

const optionNodes = (options: { value: string; label: string; disabled?: boolean }[]) =>
    options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>);

export const SettingsPanel: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const [runtime, setRuntime] = useState<AutoRollerRuntime | null>(null);
    const [profile, setProfile] = useState<Profile>("auto");
    const [autoFillLibrary, setAutoFillLibrary] = useState(true);
    const [autoCleanupImportedLyrics, setAutoCleanupImportedLyrics] = useState(false);
    const [uploadDerivePlain, setUploadDerivePlain] = useState(true);

    const [defaultLanguage, setDefaultLanguage] = useState<Language>("zh");
    const [defaultStages, setDefaultStages] = useState("s,f,t,p,a,w");
    const [defaultWriterBackend, setDefaultWriterBackend] = useState("lrc_ms");
    const [defaultWriterSpacing, setDefaultWriterSpacing] = useState<Spacing>("keep");
    const [defaultCleanup, setDefaultCleanup] = useState<Cleanup>("never");
    const [defaultLogLevel, setDefaultLogLevel] = useState<LogLevel>("INFO");

    const [splitterBackend, setSplitterBackend] = useState("demucs");
    const [splitterModel, setSplitterModel] = useState("htdemucs");
    const [splitterDevice, setSplitterDevice] = useState("");
    const [splitterJobs, setSplitterJobs] = useState("");
    const [splitterOverlap, setSplitterOverlap] = useState("");
    const [splitterSegment, setSplitterSegment] = useState("");
    const [filterChain, setFilterChain] = useState("");

    const [transcriberBackend, setTranscriberBackend] = useState("faster_whisper");
    const [transcriberDevice, setTranscriberDevice] = useState("cpu");
    const [transcriberModelName, setTranscriberModelName] = useState("large-v2");
    const [modelStore, setModelStore] = useState("");
    const [transcriberComputeType, setTranscriberComputeType] = useState("int8");
    const [transcriberBatchSize, setTranscriberBatchSize] = useState("8");
    const [defaultLocalOnly, setDefaultLocalOnly] = useState(false);
    const [hfXet, setHfXet] = useState<HfXet>("auto");
    const [hfProxy, setHfProxy] = useState("");
    const [hfEtagTimeout, setHfEtagTimeout] = useState("");
    const [hfDownloadTimeout, setHfDownloadTimeout] = useState("");
    const [hfMaxWorkers, setHfMaxWorkers] = useState("");

    const [parserEncoding, setParserEncoding] = useState("auto");
    const [alignerBackend, setAlignerBackend] = useState("global_dp_v1");
    const [alignerMinGap, setAlignerMinGap] = useState("0.5");
    const [alignerRepetition, setAlignerRepetition] = useState<Repetition>("none");
    const [writerByTag, setWriterByTag] = useState("py-roller");
    const [writerKaraokeTag, setWriterKaraokeTag] = useState<KaraokeTag>("kf");

    const [job, setJob] = useState<JobModel | null>(null);
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const data = await api.autoRollerRuntime();
            const settings = data.settings;
            const language = settings.auto_timing_default_language || "zh";
            const backend = normalizeTranscriberBackend(language, settings.auto_timing_transcriber_backend || "faster_whisper");
            setRuntime(data);
            setProfile(settings.auto_roller_profile);
            setAutoFillLibrary(settings.auto_fill_lyrics_library_from_project_metadata);
            setAutoCleanupImportedLyrics(settings.auto_cleanup_imported_lyrics);
            setUploadDerivePlain(settings.upload_derive_plain_from_synced);

            setDefaultLanguage(language);
            setDefaultStages(settings.auto_timing_default_stages || "s,f,t,p,a,w");
            setDefaultWriterBackend(settings.auto_timing_default_writer_backend || "lrc_ms");
            setDefaultWriterSpacing(settings.auto_timing_default_writer_spacing || "keep");
            setDefaultCleanup(settings.auto_timing_default_cleanup || "never");
            setDefaultLogLevel(settings.auto_timing_default_log_level || "INFO");

            setSplitterBackend(settings.auto_timing_splitter_backend || "demucs");
            setSplitterModel(settings.auto_timing_splitter_demucs_model || "htdemucs");
            setSplitterDevice(settings.auto_timing_splitter_demucs_device || "");
            setSplitterJobs(textFromOptionalNumber(settings.auto_timing_splitter_demucs_jobs));
            setSplitterOverlap(textFromOptionalNumber(settings.auto_timing_splitter_demucs_overlap));
            setSplitterSegment(textFromOptionalNumber(settings.auto_timing_splitter_demucs_segment));
            setFilterChain(settings.auto_timing_filter_chain || "");

            setTranscriberBackend(backend);
            setTranscriberDevice(settings.auto_timing_transcriber_device || "cpu");
            setTranscriberModelName(settings.auto_timing_transcriber_model_name || defaultModelFor(language, backend));
            setModelStore(settings.auto_timing_model_store || "");
            setTranscriberComputeType(settings.auto_timing_transcriber_compute_type || "int8");
            setTranscriberBatchSize(textFromOptionalNumber(settings.auto_timing_transcriber_batch_size) || "8");
            setDefaultLocalOnly(settings.auto_timing_local_files_only_default);
            setHfXet(settings.auto_timing_hf_xet || "auto");
            setHfProxy(settings.auto_timing_hf_proxy || "");
            setHfEtagTimeout(textFromOptionalNumber(settings.auto_timing_hf_etag_timeout));
            setHfDownloadTimeout(textFromOptionalNumber(settings.auto_timing_hf_download_timeout));
            setHfMaxWorkers(textFromOptionalNumber(settings.auto_timing_hf_max_workers));

            setParserEncoding(settings.auto_timing_parser_lyrics_encoding || "auto");
            setAlignerBackend(settings.auto_timing_aligner_backend || "global_dp_v1");
            setAlignerMinGap(textFromOptionalNumber(settings.auto_timing_aligner_min_gap) || "0.5");
            setAlignerRepetition(settings.auto_timing_aligner_repetition || "none");
            setWriterByTag(settings.auto_timing_writer_by_tag || "py-roller");
            setWriterKaraokeTag(settings.auto_timing_writer_ass_karaoke_tag_type || "kf");
        } catch (error) {
            setMessage((error as Error).message);
        }
    }, []);

    useEffect(() => {
        if (open) void refresh();
    }, [open, refresh]);

    useEffect(() => {
        const normalized = normalizeTranscriberBackend(defaultLanguage, transcriberBackend);
        if (normalized !== transcriberBackend) {
            setTranscriberBackend(normalized);
            setTranscriberModelName(defaultModelFor(defaultLanguage, normalized));
            return;
        }
        const allowedModels = transcriberModelOptions(defaultLanguage, normalized).map((item) => item.value);
        if (!allowedModels.includes(transcriberModelName)) {
            setTranscriberModelName(defaultModelFor(defaultLanguage, normalized));
        }
    }, [defaultLanguage, transcriberBackend, transcriberModelName]);

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

    const transcriberIsFasterWhisper = isFasterWhisper(transcriberBackend);
    const writerIsAss = defaultWriterBackend === "ass_karaoke";

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

    const saveAutoTimingDefaults = async () => {
        try {
            await savePatch({
                auto_timing_default_language: defaultLanguage,
                auto_timing_default_stages: defaultStages,
                auto_timing_default_writer_backend: defaultWriterBackend,
                auto_timing_default_writer_spacing: defaultWriterSpacing,
                auto_timing_default_cleanup: defaultCleanup,
                auto_timing_default_log_level: defaultLogLevel,

                auto_timing_splitter_backend: splitterBackend,
                auto_timing_splitter_demucs_model: splitterModel,
                auto_timing_splitter_demucs_device: splitterDevice,
                auto_timing_splitter_demucs_jobs: optionalNumber(splitterJobs),
                auto_timing_splitter_demucs_overlap: optionalNumber(splitterOverlap),
                auto_timing_splitter_demucs_segment: optionalNumber(splitterSegment),
                auto_timing_filter_chain: filterChain,

                auto_timing_transcriber_backend: transcriberBackend,
                auto_timing_transcriber_device: transcriberDevice,
                auto_timing_transcriber_model_name: transcriberModelName,
                auto_timing_model_store: modelStore.trim(),
                auto_timing_transcriber_compute_type: transcriberIsFasterWhisper ? transcriberComputeType : "",
                auto_timing_transcriber_batch_size: transcriberIsFasterWhisper ? optionalNumber(transcriberBatchSize) : null,
                auto_timing_local_files_only_default: defaultLocalOnly,
                auto_timing_hf_xet: hfXet,
                auto_timing_hf_proxy: hfProxy.trim(),
                auto_timing_hf_etag_timeout: optionalNumber(hfEtagTimeout),
                auto_timing_hf_download_timeout: optionalNumber(hfDownloadTimeout),
                auto_timing_hf_max_workers: optionalNumber(hfMaxWorkers),

                auto_timing_parser_lyrics_encoding: parserEncoding,
                auto_timing_aligner_backend: alignerBackend,
                auto_timing_aligner_min_gap: optionalNumber(alignerMinGap),
                auto_timing_aligner_repetition: alignerRepetition,
                auto_timing_writer_by_tag: writerByTag.trim(),
                auto_timing_writer_ass_karaoke_tag_type: writerIsAss ? writerKaraokeTag : "",
            }, "Auto Timing settings saved.");
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
        setMessage("Safer download settings are staged. Click Save Auto Timing settings to apply them.");
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
                setMessage("Model store selected. Click Save Auto Timing settings to apply it.");
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
                    <label className="settings-check-row"><input type="checkbox" checked={autoFillLibrary} disabled={busy} onChange={(ev) => { setAutoFillLibrary(ev.currentTarget.checked); void savePatch({ auto_fill_lyrics_library_from_project_metadata: ev.currentTarget.checked }); }} /><span><b>Auto-fill Lyrics Import from project metadata</b><small>Fill import fields from audio tags when a project is loaded.</small></span></label>
                    <label className="settings-check-row"><input type="checkbox" checked={autoCleanupImportedLyrics} disabled={busy} onChange={(ev) => { setAutoCleanupImportedLyrics(ev.currentTarget.checked); void savePatch({ auto_cleanup_imported_lyrics: ev.currentTarget.checked }); }} /><span><b>Auto-clean imported LRC</b><small>Clean imported synced lyrics before placing them into the editor.</small></span></label>
                </section>

                <section className="settings-section">
                    <h3>Upload</h3>
                    <label className="settings-check-row"><input type="checkbox" checked={uploadDerivePlain} disabled={busy} onChange={(ev) => { setUploadDerivePlain(ev.currentTarget.checked); void savePatch({ upload_derive_plain_from_synced: ev.currentTarget.checked }); }} /><span><b>Derive plain lyrics from synced lyrics</b><small>Submit timestamp-stripped plain lyrics when uploading synced LRC.</small></span></label>
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
                    <div className="roller-form settings-profile-row"><label>Install profile<select value={profile} disabled={busy} onChange={(ev) => void saveProfile(ev.target.value as Profile)}><option value="auto">Auto</option><option value="cpu">CPU only</option><option value="cu124">CUDA 12.4</option></select></label></div>
                    <div className="roller-actions"><button type="button" disabled={busy} onClick={runDoctor}>Run runtime check</button><button type="button" disabled={busy} onClick={() => void runInstall(false)}>Install / repair</button><button type="button" disabled={busy} onClick={() => void runInstall(true)}>Dry run install</button><button type="button" onClick={copyDiagnostics}>Copy diagnostics</button><button type="button" onClick={refresh}>Refresh</button></div>
                </section>

                <section className="settings-section">
                    <h3>Auto Timing Task Settings</h3>
                    <p className="roller-muted">Used by new automatic timing tasks unless changed in the task panel.</p>
                    <div className="roller-section-title">Core</div>
                    <div className="roller-form two-col">
                        <label>Language<select value={defaultLanguage} onChange={(ev) => setDefaultLanguage(ev.target.value as Language)}>{optionNodes(LANGUAGE_OPTIONS)}</select></label>
                        <label>Processing preset<select value={defaultStages} onChange={(ev) => setDefaultStages(ev.target.value)}>{optionNodes(STAGE_OPTIONS)}</select></label>
                        <label>Output format<select value={defaultWriterBackend} onChange={(ev) => setDefaultWriterBackend(ev.target.value)}>{optionNodes(WRITER_OPTIONS)}</select></label>
                        <label>Repetition handling<select value={alignerRepetition} onChange={(ev) => setAlignerRepetition(ev.target.value as Repetition)}>{optionNodes(REPETITION_OPTIONS)}</select></label>
                        <label>Spacing<select value={defaultWriterSpacing} onChange={(ev) => setDefaultWriterSpacing(ev.target.value as Spacing)}>{optionNodes(SPACING_OPTIONS)}</select></label>
                        <label>Cleanup policy<select value={defaultCleanup} onChange={(ev) => setDefaultCleanup(ev.target.value as Cleanup)}>{optionNodes(CLEANUP_OPTIONS)}</select></label>
                        <label>Log level<select value={defaultLogLevel} onChange={(ev) => setDefaultLogLevel(ev.target.value as LogLevel)}>{optionNodes(LOG_LEVEL_OPTIONS)}</select></label>
                    </div>

                    <details>
                        <summary>Stage settings</summary>
                        <div className="roller-section-title">Splitter</div>
                        <div className="roller-form two-col">
                            <label>Backend<select value={splitterBackend} onChange={(ev) => setSplitterBackend(ev.target.value)}>{optionNodes(SPLITTER_BACKEND_OPTIONS)}</select></label>
                            <label>Demucs model<select value={splitterModel} onChange={(ev) => setSplitterModel(ev.target.value)}>{optionNodes(DEMUCS_MODEL_OPTIONS)}</select></label>
                            <label>Device<select value={splitterDevice} onChange={(ev) => setSplitterDevice(ev.target.value)}>{optionNodes(DEMUCS_DEVICE_OPTIONS)}</select></label>
                            <label>Jobs<input inputMode="numeric" placeholder="Let Demucs choose" value={splitterJobs} onChange={(ev) => setSplitterJobs(ev.target.value)} /></label>
                            <label>Overlap<input inputMode="decimal" placeholder="Demucs built-in" value={splitterOverlap} onChange={(ev) => setSplitterOverlap(ev.target.value)} /></label>
                            <label>Segment seconds<input inputMode="decimal" placeholder="Demucs built-in" value={splitterSegment} onChange={(ev) => setSplitterSegment(ev.target.value)} /></label>
                        </div>

                        <div className="roller-section-title">Filter</div>
                        <div className="roller-form"><label>Filter chain<select value={filterChain} onChange={(ev) => setFilterChain(ev.target.value)}>{optionNodes(FILTER_CHAIN_OPTIONS)}</select></label></div>

                        <div className="roller-section-title">Transcriber and model download</div>
                        <div className="roller-form two-col">
                            <label>Backend<select value={transcriberBackend} onChange={(ev) => setTranscriberBackend(ev.target.value)}>{optionNodes(transcriberBackendOptions(defaultLanguage))}</select></label>
                            <label>Device<select value={transcriberDevice} onChange={(ev) => setTranscriberDevice(ev.target.value)}>{optionNodes(DEVICE_OPTIONS)}</select></label>
                            <label>Model name<select value={transcriberModelName} onChange={(ev) => setTranscriberModelName(ev.target.value)}>{optionNodes(transcriberModelOptions(defaultLanguage, transcriberBackend))}</select></label>
                            <label className="field-with-browse">Model store path<span className="browse-row"><input placeholder={runtime?.model_store || "~/.cache/py-roller/models/transcriber"} value={modelStore} onChange={(ev) => setModelStore(ev.target.value)} /><button type="button" disabled={busy} onClick={browseModelStore}>Browse</button></span></label>
                            <label>Compute type<select value={transcriberComputeType} onChange={(ev) => setTranscriberComputeType(ev.target.value)} disabled={!transcriberIsFasterWhisper}>{optionNodes(COMPUTE_TYPE_OPTIONS)}</select></label>
                            <label>Batch size<input inputMode="numeric" placeholder="8" value={transcriberBatchSize} onChange={(ev) => setTranscriberBatchSize(ev.target.value)} disabled={!transcriberIsFasterWhisper} /></label>
                            <label>HF XET / CAS<select value={hfXet} onChange={(ev) => setHfXet(ev.target.value as HfXet)}>{optionNodes(HF_XET_OPTIONS)}</select></label>
                            <label>Proxy URL<input placeholder="http://127.0.0.1:7890" value={hfProxy} onChange={(ev) => setHfProxy(ev.target.value)} /></label>
                            <label>Metadata timeout<input inputMode="decimal" placeholder="library built-in" value={hfEtagTimeout} onChange={(ev) => setHfEtagTimeout(ev.target.value)} /></label>
                            <label>File download timeout<input inputMode="decimal" placeholder="library built-in" value={hfDownloadTimeout} onChange={(ev) => setHfDownloadTimeout(ev.target.value)} /></label>
                            <label>Max download workers<input inputMode="numeric" placeholder="library built-in" value={hfMaxWorkers} onChange={(ev) => setHfMaxWorkers(ev.target.value)} /></label>
                            <label className="roller-checkbox">Use local cache only<input type="checkbox" checked={defaultLocalOnly} onChange={(ev) => setDefaultLocalOnly(ev.currentTarget.checked)} /></label>
                        </div>
                        <div className="roller-actions download-presets"><button type="button" disabled={busy} onClick={applySafeDefaults}>Use safer download settings</button></div>

                        <div className="roller-section-title">Parser</div>
                        <div className="roller-form"><label>Lyrics encoding<select value={parserEncoding} onChange={(ev) => setParserEncoding(ev.target.value)}>{optionNodes(PARSER_ENCODING_OPTIONS)}</select></label></div>

                        <div className="roller-section-title">Aligner</div>
                        <div className="roller-form two-col"><label>Backend<select value={alignerBackend} onChange={(ev) => setAlignerBackend(ev.target.value)}>{optionNodes(ALIGNER_BACKEND_OPTIONS)}</select></label><label>Min gap seconds<input inputMode="decimal" placeholder="0.5" value={alignerMinGap} onChange={(ev) => setAlignerMinGap(ev.target.value)} /></label></div>

                        <div className="roller-section-title">Writer</div>
                        <div className="roller-form two-col"><label>BY tag<input placeholder="py-roller" value={writerByTag} onChange={(ev) => setWriterByTag(ev.target.value)} /></label><label>ASS karaoke tag<select value={writerKaraokeTag} onChange={(ev) => setWriterKaraokeTag(ev.target.value as KaraokeTag)} disabled={!writerIsAss}>{optionNodes(KARAOKE_TAG_OPTIONS)}</select></label></div>
                    </details>
                    <div className="roller-actions"><button type="button" disabled={busy} onClick={() => void saveAutoTimingDefaults()}>Save Auto Timing settings</button></div>
                </section>

                {message && <p className="roller-message">{message}</p>}
                {job && <section className="settings-section"><details open><summary>{job.kind} · {job.job_id} · {job.status}</summary><pre className="roller-log">{job.logs.join("\n") || job.command.join(" ")}</pre></details></section>}

                <section className="settings-section"><h3>About</h3><p className="roller-muted">lrc-roller is a local front-end workflow for lyrics lookup, automatic timing, manual editing, and publishing.</p></section>
            </aside>
        </div>
    );
};
