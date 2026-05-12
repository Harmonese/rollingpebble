import { useEffect, useMemo, useState } from "react";
import {
  api,
  type JobModel,
  type MetaModel,
  type ProjectModel,
  type RollPreview,
} from "../../shared/api.js";
import { hasLyricContent } from "../../shared/lrc.js";
import { SETTINGS_UPDATED_EVENT } from "../../shared/settingsEvents.js";
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
  includesStage,
  isFasterWhisper,
  normalizeTranscriberBackend,
  transcriberBackendOptions,
  transcriberModelOptions,
  type HfXet,
  type Language,
  type LocalOnly,
  type Repetition,
} from "./autoTimingOptions.js";

function optionalNumberValue(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

type InputState = {
  ready: boolean;
  audioReady: boolean;
  lyricsReady: boolean;
  reason: string;
};

function computeInputState(
  project: ProjectModel | null,
  plainLyrics: string,
  syncedLyrics: string,
): InputState {
  const audioReady = Boolean(project?.audio_path);
  const lyricsReady = hasLyricContent(plainLyrics) || hasLyricContent(syncedLyrics);
  if (!project) {
    return { ready: false, audioReady, lyricsReady, reason: "Create or open a project first." };
  }
  if (!audioReady) {
    return { ready: false, audioReady, lyricsReady, reason: "This project has no audio file." };
  }
  if (!lyricsReady) {
    return {
      ready: false,
      audioReady,
      lyricsReady,
      reason: "Import or paste real lyric lines before automatic timing. LRC metadata headers are ignored.",
    };
  }
  return { ready: true, audioReady, lyricsReady, reason: "Ready." };
}

function progressStageLabel(stage: string): string {
  if (!stage) return "Preparing";
  return stage
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const optionNodes = (options: { value: string; label: string; disabled?: boolean }[]) =>
  options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>);

export const RollerPanel: React.FC<{
  project: ProjectModel | null;
  plainLyrics: string;
  syncedLyrics: string;
  editorMeta: MetaModel;
  onProject: (project: ProjectModel, applyToEditor?: boolean) => void;
  onImportText: (text: string) => void;
}> = ({ project, plainLyrics, syncedLyrics, editorMeta, onProject, onImportText }) => {
  const [language, setLanguage] = useState<Language>("zh");
  const [stages, setStages] = useState("s,f,t,p,a,w");
  const [writerBackend, setWriterBackend] = useState("lrc_ms");
  const [writerSpacing, setWriterSpacing] = useState("keep");
  const [alignerRepetition, setAlignerRepetition] = useState<Repetition>("none");
  const [transcriberModelPath, setTranscriberModelPath] = useState("");

  const [cleanup, setCleanup] = useState("never");
  const [logLevel, setLogLevel] = useState("INFO");
  const [parserEncoding, setParserEncoding] = useState("auto");

  const [splitterBackend, setSplitterBackend] = useState("demucs");
  const [splitterModel, setSplitterModel] = useState("htdemucs");
  const [splitterDevice, setSplitterDevice] = useState("");
  const [splitterJobs, setSplitterJobs] = useState("");
  const [splitterOverlap, setSplitterOverlap] = useState("");
  const [splitterSegment, setSplitterSegment] = useState("");
  const [filterChain, setFilterChain] = useState("");

  const [transcriberBackend, setTranscriberBackend] = useState("faster_whisper");
  const [transcriberDevice, setTranscriberDevice] = useState("cpu");
  const [transcriberModel, setTranscriberModel] = useState("large-v2");
  const [transcriberComputeType, setTranscriberComputeType] = useState("int8");
  const [transcriberBatchSize, setTranscriberBatchSize] = useState("8");
  const [localOnly, setLocalOnly] = useState<LocalOnly>("off");
  const [hfXet, setHfXet] = useState<HfXet>("auto");
  const [hfProxy, setHfProxy] = useState("");
  const [hfEtagTimeout, setHfEtagTimeout] = useState("");
  const [hfDownloadTimeout, setHfDownloadTimeout] = useState("");
  const [hfMaxWorkers, setHfMaxWorkers] = useState("");

  const [alignerBackend, setAlignerBackend] = useState("global_dp_v1");
  const [alignerMinGap, setAlignerMinGap] = useState("0.5");
  const [writerByTag, setWriterByTag] = useState("py-roller");
  const [writerKaraokeTag, setWriterKaraokeTag] = useState("kf");

  const [job, setJob] = useState<JobModel | null>(null);
  const [preview, setPreview] = useState<RollPreview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const inputState = useMemo(
    () => computeInputState(project, plainLyrics, syncedLyrics),
    [project, plainLyrics, syncedLyrics],
  );

  const loadDefaults = async () => {
    try {
      const settings = await api.settings();
      const nextLanguage = settings.auto_timing_default_language || "zh";
      const nextBackend = normalizeTranscriberBackend(nextLanguage, settings.auto_timing_transcriber_backend || "faster_whisper");
      const nextModel = settings.auto_timing_transcriber_model_name || defaultModelFor(nextLanguage, nextBackend);
      setLanguage(nextLanguage);
      setStages(settings.auto_timing_default_stages || "s,f,t,p,a,w");
      setWriterBackend(settings.auto_timing_default_writer_backend || "lrc_ms");
      setWriterSpacing(settings.auto_timing_default_writer_spacing || "keep");
      setCleanup(settings.auto_timing_default_cleanup || "never");
      setLogLevel(settings.auto_timing_default_log_level || "INFO");
      setAlignerRepetition(settings.auto_timing_aligner_repetition || "none");
      setSplitterBackend(settings.auto_timing_splitter_backend || "demucs");
      setSplitterModel(settings.auto_timing_splitter_demucs_model || "htdemucs");
      setSplitterDevice(settings.auto_timing_splitter_demucs_device || "");
      setSplitterJobs(settings.auto_timing_splitter_demucs_jobs == null ? "" : String(settings.auto_timing_splitter_demucs_jobs));
      setSplitterOverlap(settings.auto_timing_splitter_demucs_overlap == null ? "" : String(settings.auto_timing_splitter_demucs_overlap));
      setSplitterSegment(settings.auto_timing_splitter_demucs_segment == null ? "" : String(settings.auto_timing_splitter_demucs_segment));
      setFilterChain(settings.auto_timing_filter_chain || "");
      setTranscriberBackend(nextBackend);
      setTranscriberDevice(settings.auto_timing_transcriber_device || "cpu");
      setTranscriberModel(nextModel);
      setTranscriberModelPath(settings.auto_timing_model_store || "");
      setTranscriberComputeType(settings.auto_timing_transcriber_compute_type || "int8");
      setTranscriberBatchSize(settings.auto_timing_transcriber_batch_size == null ? "8" : String(settings.auto_timing_transcriber_batch_size));
      setLocalOnly(settings.auto_timing_local_files_only_default ? "on" : "off");
      setHfXet(settings.auto_timing_hf_xet || "auto");
      setHfProxy(settings.auto_timing_hf_proxy || "");
      setHfEtagTimeout(settings.auto_timing_hf_etag_timeout == null ? "" : String(settings.auto_timing_hf_etag_timeout));
      setHfDownloadTimeout(settings.auto_timing_hf_download_timeout == null ? "" : String(settings.auto_timing_hf_download_timeout));
      setHfMaxWorkers(settings.auto_timing_hf_max_workers == null ? "" : String(settings.auto_timing_hf_max_workers));
      setParserEncoding(settings.auto_timing_parser_lyrics_encoding || "auto");
      setAlignerBackend(settings.auto_timing_aligner_backend || "global_dp_v1");
      setAlignerMinGap(settings.auto_timing_aligner_min_gap == null ? "0.5" : String(settings.auto_timing_aligner_min_gap));
      setWriterByTag(settings.auto_timing_writer_by_tag || "py-roller");
      setWriterKaraokeTag(settings.auto_timing_writer_ass_karaoke_tag_type || "kf");
    } catch {
      // Settings are optional for initial rendering. Keep built-in defaults.
    }
  };

  useEffect(() => {
    void loadDefaults();
    const listener = () => void loadDefaults();
    window.addEventListener(SETTINGS_UPDATED_EVENT, listener);
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, listener);
  }, []);

  useEffect(() => {
    const normalized = normalizeTranscriberBackend(language, transcriberBackend);
    if (normalized !== transcriberBackend) {
      setTranscriberBackend(normalized);
      setTranscriberModel(defaultModelFor(language, normalized));
      return;
    }
    const allowedModels = transcriberModelOptions(language, normalized).map((option) => option.value);
    if (!allowedModels.includes(transcriberModel)) {
      setTranscriberModel(defaultModelFor(language, normalized));
    }
  }, [language, transcriberBackend, transcriberModel]);

  const includesSplitter = includesStage(stages, "s");
  const includesFilter = includesStage(stages, "f");
  const includesTranscriber = includesStage(stages, "t");
  const includesParser = includesStage(stages, "p");
  const includesAligner = includesStage(stages, "a");
  const includesWriter = includesStage(stages, "w");
  const transcriberIsFasterWhisper = isFasterWhisper(transcriberBackend);
  const writerIsAss = writerBackend === "ass_karaoke";

  const rollPayload = useMemo(() => {
    const payload: Record<string, unknown> = {
      language,
      stages,
      cleanup,
      log_level: logLevel,
    };
    if (includesWriter) {
      payload.writer_backend = writerBackend;
      payload.writer_spacing = writerSpacing;
      payload.writer_by_tag = writerByTag.trim() || null;
      payload.writer_ass_karaoke_tag_type = writerIsAss ? writerKaraokeTag : null;
    }
    if (includesSplitter) {
      payload.splitter_backend = splitterBackend || null;
      payload.splitter_demucs_model = splitterModel || null;
      payload.splitter_demucs_device = splitterDevice || null;
      payload.splitter_demucs_jobs = optionalNumberValue(splitterJobs);
      payload.splitter_demucs_overlap = optionalNumberValue(splitterOverlap);
      payload.splitter_demucs_segment = optionalNumberValue(splitterSegment);
    }
    if (includesFilter) {
      payload.filter_chain = filterChain || null;
    }
    if (includesTranscriber) {
      payload.transcriber_backend = transcriberBackend || null;
      payload.transcriber_device = transcriberDevice || null;
      payload.transcriber_model_name = transcriberModel || null;
      payload.transcriber_model_path = transcriberModelPath.trim() || null;
      payload.transcriber_local_files_only = localOnly === "on";
      payload.transcriber_hf_xet = hfXet;
      payload.transcriber_hf_proxy = hfProxy.trim() || null;
      payload.transcriber_hf_etag_timeout = optionalNumberValue(hfEtagTimeout);
      payload.transcriber_hf_download_timeout = optionalNumberValue(hfDownloadTimeout);
      payload.transcriber_hf_max_workers = optionalNumberValue(hfMaxWorkers);
      payload.transcriber_compute_type = transcriberIsFasterWhisper ? transcriberComputeType : null;
      payload.transcriber_batch_size = transcriberIsFasterWhisper ? optionalNumberValue(transcriberBatchSize) : null;
    }
    if (includesParser) {
      payload.parser_lyrics_encoding = parserEncoding || "auto";
    }
    if (includesAligner) {
      payload.aligner_backend = alignerBackend || null;
      payload.aligner_min_gap = optionalNumberValue(alignerMinGap);
      payload.aligner_repetition = alignerRepetition;
    }
    return payload;
  }, [alignerBackend, alignerMinGap, alignerRepetition, cleanup, filterChain, hfDownloadTimeout, hfEtagTimeout, hfMaxWorkers, hfProxy, hfXet, includesAligner, includesFilter, includesParser, includesSplitter, includesTranscriber, includesWriter, language, localOnly, logLevel, parserEncoding, splitterBackend, splitterDevice, splitterJobs, splitterModel, splitterOverlap, splitterSegment, stages, transcriberBackend, transcriberBatchSize, transcriberComputeType, transcriberDevice, transcriberIsFasterWhisper, transcriberModel, transcriberModelPath, writerBackend, writerByTag, writerIsAss, writerKaraokeTag, writerSpacing]);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const updated = await api.getJob(job.job_id);
        setJob(updated);
        if (updated.status === "succeeded" && updated.result?.synced_lyrics) {
          onImportText(String(updated.result.synced_lyrics));
          if (project) {
            const refreshed = await api.getProject(project.project_id);
            onProject(refreshed, false);
          }
          setMessage("Automatic timing finished and imported the generated LRC.");
        }
        if (updated.status === "failed") setMessage(updated.error || "Automatic timing failed.");
        if (updated.status === "canceled") setMessage("Automatic timing was canceled.");
      } catch (error) {
        setMessage((error as Error).message);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job, onImportText, onProject, project]);

  const saveAndPreview = async () => {
    if (!project) throw new Error("Create or open a project first.");
    await api.saveEditor(project.project_id, { plain_lyrics: plainLyrics, synced_lyrics: syncedLyrics, metadata: editorMeta });
    const next = await api.rollPreview(project.project_id, rollPayload);
    setPreview(next);
    return next;
  };

  const refreshPreview = async () => {
    if (!project) {
      setMessage("Create or open a project first.");
      return;
    }
    setBusy(true);
    setMessage("Preparing command preview...");
    try {
      await saveAndPreview();
      setMessage("Command preview is ready.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!project) {
      setMessage("Create or open a project first.");
      return;
    }
    if (!inputState.ready) {
      setMessage(inputState.reason);
      return;
    }
    setBusy(true);
    setMessage("Starting automatic timing...");
    try {
      await saveAndPreview();
      const created = await api.roll(project.project_id, rollPayload);
      setJob(created);
      setMessage(`Started ${created.job_id}`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setMessage("Retrying with the current settings...");
    await start();
  };

  const cancel = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const canceled = await api.cancelJob(job.job_id);
      setJob(canceled);
      setMessage("Cancel requested.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyCommand = async () => {
    const text = preview?.command_text || job?.command.join(" ") || "";
    if (!text) return;
    await navigator.clipboard?.writeText(text);
    setMessage("Command copied.");
  };

  const copyLog = async () => {
    if (!job) return;
    await navigator.clipboard?.writeText(job.logs.join("\n") || job.command.join(" "));
    setMessage("Task log copied.");
  };

  const openProjectFolder = async () => {
    if (!project) return;
    try {
      const result = await api.openProjectFolder(project.project_id);
      setMessage(`Opened ${result.path}`);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const importResult = () => {
    if (job?.result?.synced_lyrics) {
      onImportText(String(job.result.synced_lyrics));
      setMessage("Generated LRC imported into the editor.");
    }
  };

  const browseModelPath = async () => {
    try {
      const result = await api.selectLocalPath({ mode: "directory", title: "Select model folder", initial_path: transcriberModelPath || null });
      if (!result.canceled && result.path) {
        setTranscriberModelPath(result.path);
        setMessage("Model folder selected.");
      }
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const useSaferDownload = () => {
    setLocalOnly("off");
    setHfXet("off");
    setHfEtagTimeout("120");
    setHfDownloadTimeout("300");
    setHfMaxWorkers("1");
    setMessage("Safer download settings are staged for this run.");
  };

  const useOfflineCache = () => {
    setLocalOnly("on");
    setMessage("This run will use local model cache only.");
  };

  const running = !!job && ["queued", "running"].includes(job.status);
  const selectedStage = STAGE_OPTIONS.find((item) => item.value === stages);
  const startDisabled = busy || running || !inputState.ready;
  const logsOpen = !!job && ["running", "failed", "succeeded", "canceled"].includes(job.status);
  const progress = job?.progress || null;
  const progressPercent = progress?.percent ?? null;
  const progressWidth = typeof progressPercent === "number" && Number.isFinite(progressPercent) ? `${Math.max(0, Math.min(1, progressPercent)) * 100}%` : undefined;
  const showProgress = !!job && ["queued", "running", "succeeded", "failed", "canceled"].includes(job.status);

  return (
    <section className="roller-card">
      <h2>Auto Timing</h2>
      <p className="roller-muted">Generate synced lyrics from this song.</p>

      <div className="roller-section-title">Input status</div>
      <div className="roller-input-status">
        <span className={inputState.audioReady ? "status-ok" : "status-missing"}>Audio: {inputState.audioReady ? "ready" : "missing"}</span>
        <span className={inputState.lyricsReady ? "status-ok" : "status-missing"}>Lyrics: {inputState.lyricsReady ? "ready" : "missing"}</span>
      </div>
      {!inputState.ready && <p className="roller-warning">{inputState.reason}</p>}

      <div className="roller-section-title">Basic settings</div>
      <div className="roller-form two-col">
        <label>Lyrics language
          <select value={language} onChange={(ev) => setLanguage(ev.target.value as Language)}>
            {optionNodes(LANGUAGE_OPTIONS)}
          </select>
        </label>
        <label>Processing preset
          <select value={stages} onChange={(ev) => setStages(ev.target.value)}>
            {optionNodes(STAGE_OPTIONS)}
          </select>
        </label>
        <label>Output format
          <select value={writerBackend} onChange={(ev) => setWriterBackend(ev.target.value)}>
            {optionNodes(WRITER_OPTIONS)}
          </select>
        </label>
        <label>Repetition handling
          <select value={alignerRepetition} onChange={(ev) => setAlignerRepetition(ev.target.value as Repetition)} disabled={!includesAligner}>
            {optionNodes(REPETITION_OPTIONS)}
          </select>
        </label>
        <label className="field-with-browse">Model folder
          <span className="browse-row"><input placeholder="py-roller model store" value={transcriberModelPath} onChange={(ev) => setTranscriberModelPath(ev.target.value)} disabled={!includesTranscriber} /><button type="button" onClick={browseModelPath} disabled={!includesTranscriber}>Browse</button></span>
        </label>
        <label>Spacing
          <select value={writerSpacing} onChange={(ev) => setWriterSpacing(ev.target.value)} disabled={!includesWriter}>
            {optionNodes(SPACING_OPTIONS)}
          </select>
        </label>
      </div>
      {selectedStage && <p className="roller-muted">{selectedStage.help}</p>}

      <details>
        <summary>Advanced task parameters</summary>
        <p className="roller-muted">Values are initialized from Settings. Change them here to override this run.</p>

        <div className="roller-section-title">Pipeline runtime</div>
        <div className="roller-form two-col">
          <label>Cleanup policy<select value={cleanup} onChange={(ev) => setCleanup(ev.target.value)}>{optionNodes(CLEANUP_OPTIONS)}</select></label>
          <label>Log level<select value={logLevel} onChange={(ev) => setLogLevel(ev.target.value)}>{optionNodes(LOG_LEVEL_OPTIONS)}</select></label>
        </div>

        {includesSplitter && (
          <>
            <div className="roller-section-title">Splitter</div>
            <div className="roller-form two-col">
              <label>Backend<select value={splitterBackend} onChange={(ev) => setSplitterBackend(ev.target.value)}>{optionNodes(SPLITTER_BACKEND_OPTIONS)}</select></label>
              <label>Demucs model<select value={splitterModel} onChange={(ev) => setSplitterModel(ev.target.value)}>{optionNodes(DEMUCS_MODEL_OPTIONS)}</select></label>
              <label>Device<select value={splitterDevice} onChange={(ev) => setSplitterDevice(ev.target.value)}>{optionNodes(DEMUCS_DEVICE_OPTIONS)}</select></label>
              <label>Jobs<input inputMode="numeric" placeholder="Let Demucs choose" value={splitterJobs} onChange={(ev) => setSplitterJobs(ev.target.value)} /></label>
              <label>Overlap<input inputMode="decimal" placeholder="Demucs built-in" value={splitterOverlap} onChange={(ev) => setSplitterOverlap(ev.target.value)} /></label>
              <label>Segment seconds<input inputMode="decimal" placeholder="Demucs built-in" value={splitterSegment} onChange={(ev) => setSplitterSegment(ev.target.value)} /></label>
            </div>
          </>
        )}

        {includesFilter && (
          <>
            <div className="roller-section-title">Filter</div>
            <div className="roller-form"><label>Filter chain<select value={filterChain} onChange={(ev) => setFilterChain(ev.target.value)}>{optionNodes(FILTER_CHAIN_OPTIONS)}</select></label></div>
          </>
        )}

        {includesTranscriber && (
          <>
            <div className="roller-section-title">Transcriber</div>
            <div className="roller-form two-col">
              <label>Backend<select value={transcriberBackend} onChange={(ev) => setTranscriberBackend(ev.target.value)}>{optionNodes(transcriberBackendOptions(language))}</select></label>
              <label>Device<select value={transcriberDevice} onChange={(ev) => setTranscriberDevice(ev.target.value)}>{optionNodes(DEVICE_OPTIONS)}</select></label>
              <label>Model name<select value={transcriberModel} onChange={(ev) => setTranscriberModel(ev.target.value)}>{optionNodes(transcriberModelOptions(language, transcriberBackend))}</select></label>
              <label>Compute type<select value={transcriberComputeType} onChange={(ev) => setTranscriberComputeType(ev.target.value)} disabled={!transcriberIsFasterWhisper}>{optionNodes(COMPUTE_TYPE_OPTIONS)}</select></label>
              <label>Batch size<input inputMode="numeric" placeholder="8" value={transcriberBatchSize} onChange={(ev) => setTranscriberBatchSize(ev.target.value)} disabled={!transcriberIsFasterWhisper} /></label>
              <label>Local cache mode<select value={localOnly} onChange={(ev) => setLocalOnly(ev.target.value as LocalOnly)}><option value="off">Allow download if missing</option><option value="on">Use local cache only</option></select></label>
            </div>

            <div className="roller-section-title">Model download</div>
            <div className="roller-form two-col">
              <label>HF XET / CAS<select value={hfXet} onChange={(ev) => setHfXet(ev.target.value as HfXet)}>{optionNodes(HF_XET_OPTIONS)}</select></label>
              <label>Proxy URL<input placeholder="http://127.0.0.1:7890" value={hfProxy} onChange={(ev) => setHfProxy(ev.target.value)} /></label>
              <label>Metadata timeout, seconds<input inputMode="decimal" placeholder="library built-in" value={hfEtagTimeout} onChange={(ev) => setHfEtagTimeout(ev.target.value)} /></label>
              <label>File download timeout, seconds<input inputMode="decimal" placeholder="library built-in" value={hfDownloadTimeout} onChange={(ev) => setHfDownloadTimeout(ev.target.value)} /></label>
              <label>Max download workers<input inputMode="numeric" placeholder="library built-in" value={hfMaxWorkers} onChange={(ev) => setHfMaxWorkers(ev.target.value)} /></label>
            </div>
            <div className="roller-actions download-presets"><button type="button" onClick={useSaferDownload}>Safer download</button><button type="button" onClick={useOfflineCache}>Offline cache</button></div>
          </>
        )}

        {includesParser && (
          <>
            <div className="roller-section-title">Parser</div>
            <div className="roller-form"><label>Lyrics encoding<select value={parserEncoding} onChange={(ev) => setParserEncoding(ev.target.value)}>{optionNodes(PARSER_ENCODING_OPTIONS)}</select></label></div>
          </>
        )}

        {includesAligner && (
          <>
            <div className="roller-section-title">Aligner</div>
            <div className="roller-form two-col">
              <label>Backend<select value={alignerBackend} onChange={(ev) => setAlignerBackend(ev.target.value)}>{optionNodes(ALIGNER_BACKEND_OPTIONS)}</select></label>
              <label>Min gap seconds<input inputMode="decimal" placeholder="0.5" value={alignerMinGap} onChange={(ev) => setAlignerMinGap(ev.target.value)} /></label>
            </div>
          </>
        )}

        {includesWriter && (
          <>
            <div className="roller-section-title">Writer</div>
            <div className="roller-form two-col">
              <label>BY tag<input placeholder="py-roller" value={writerByTag} onChange={(ev) => setWriterByTag(ev.target.value)} /></label>
              <label>ASS karaoke tag<select value={writerKaraokeTag} onChange={(ev) => setWriterKaraokeTag(ev.target.value)} disabled={!writerIsAss}>{optionNodes(KARAOKE_TAG_OPTIONS)}</select></label>
            </div>
          </>
        )}
      </details>

      {showProgress && (
        <section className="roller-progress-block" aria-live="polite">
          <div className="roller-progress-head">
            <b>{progressStageLabel(progress?.stage || (job?.status === "queued" ? "queued" : "running"))}</b>
            <span>{typeof progressPercent === "number" ? `${Math.round(progressPercent * 100)}%` : job?.status}</span>
          </div>
          <div className={progressWidth ? "roller-progress-bar" : "roller-progress-bar indeterminate"}>
            <span style={progressWidth ? { width: progressWidth } : undefined} />
          </div>
          {progress?.message && <p className="roller-muted">{progress.message}</p>}
          {progress && progress.total > 0 && <p className="roller-muted">{progress.completed}/{progress.total} {progress.unit}</p>}
        </section>
      )}

      <div className="roller-section-title">Run</div>
      <div className="roller-actions">
        <button type="button" disabled={startDisabled} onClick={() => void start()}>Start automatic timing</button>
        <button type="button" disabled={busy || !project} onClick={() => void refreshPreview()}>Preview command</button>
        <button type="button" disabled={!running || busy} onClick={() => void cancel()}>Cancel</button>
        <button type="button" disabled={busy || running || !project} onClick={() => void retry()}>Retry</button>
        <button type="button" disabled={!preview && !job} onClick={() => void copyCommand()}>Copy command</button>
        <button type="button" disabled={!job} onClick={() => void copyLog()}>Copy log</button>
        <button type="button" disabled={!project} onClick={() => void openProjectFolder()}>Open folder</button>
        <button type="button" disabled={!job?.result?.synced_lyrics} onClick={importResult}>Import result</button>
      </div>
      {startDisabled && !running && <p className="roller-warning">{inputState.reason}</p>}
      {message && <p className="roller-message">{message}</p>}

      <details open={!!preview}>
        <summary>Command preview</summary>
        {preview?.warnings?.map((warning) => <p key={warning} className="roller-warning">{warning}</p>)}
        <pre className="roller-command">{preview?.command_text || "Preview the command before running."}</pre>
      </details>

      {job && (
        <details open={logsOpen}>
          <summary>{job.job_id} · {job.status}</summary>
          {job.error && <p className="roller-warning">{job.error}</p>}
          <pre className="roller-log">{job.logs.join("\n") || job.command.join(" ")}</pre>
        </details>
      )}
    </section>
  );
};
