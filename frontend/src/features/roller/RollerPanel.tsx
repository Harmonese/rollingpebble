import { useContext, useEffect, useMemo, useState } from "react";
import { useAutoTimingState } from "../../hooks/useAutoTimingState.js";
import { useMessage } from "../../hooks/useMessage.js";
import { toastPubSub } from "../../components/toast.js";
import { appContext, ChangBits } from "../../components/app.context.js";
import {
  api,
  type JobModel,
  type MetaModel,
  type ProjectModel,
  type RollPreview,
} from "../../shared/api.js";
import { formatBytes } from "../../shared/format.js";
import { hasLyricContent } from "../../shared/lrc.js";
import { optionNodes } from "../../shared/optionNodes.js";
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
  LOCAL_CACHE_OPTIONS,
  LOG_LEVEL_OPTIONS,
  PARSER_ENCODING_OPTIONS,
  REPETITION_OPTIONS,
  SPACING_OPTIONS,
  SPLITTER_BACKEND_OPTIONS,
  STAGE_OPTIONS,
  VAD_FILTER_OPTIONS,
  WRITER_OPTIONS,
  includesStage,
  transcriberBackendOptions,
  transcriberModelOptions,
  type HfXet,
  type Language,
  type LocalOnly,
  type Repetition,
} from "./autoTimingOptions.js";

function formatCommandPreview(commandText: string | null | undefined, placeholder: string): string {
  if (!commandText) return placeholder;
  return commandText.replace(/\s--/g, " \\\n  --");
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
  stages: string,
  msgs: { noProject: string; noAudio: string; noLyrics: string; ready: string },
): InputState {
  const needsAudio = includesStage(stages, "s") || includesStage(stages, "f") || includesStage(stages, "t");
  const needsLyrics = includesStage(stages, "p");
  const audioReady = !needsAudio || Boolean(project?.audio_path);
  const lyricsReady = !needsLyrics || hasLyricContent(plainLyrics) || hasLyricContent(syncedLyrics);
  if (!project) {
    return { ready: false, audioReady, lyricsReady, reason: msgs.noProject };
  }
  if (!audioReady) {
    return { ready: false, audioReady, lyricsReady, reason: msgs.noAudio };
  }
  if (!lyricsReady) {
    return { ready: false, audioReady, lyricsReady, reason: msgs.noLyrics };
  }
  return { ready: true, audioReady, lyricsReady, reason: msgs.ready };
}

function normalizeProgressStage(stage: string): string {
  const normalized = (stage || "").replace(/-/g, "_");
  if (normalized === "transcriber_preflight") return "preflight";
  if (normalized === "model_download") return "model_download";
  return normalized;
}

function progressStageLabel(stage: string, labels: Record<string, string>, fallbacks: { preparing: string; complete: string }): string {
  const normalizedStage = normalizeProgressStage(stage);
  if (!normalizedStage) return fallbacks.preparing;
  if (labels[normalizedStage]) return labels[normalizedStage];
  if (normalizedStage === "complete") return fallbacks.complete;
  return normalizedStage
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}


function progressMessage(progress: JobModel["progress"], msg: { waiting: string; working: string }): string {
  if (!progress) return msg.waiting;
  if (progress.bytes_downloaded != null || progress.bytes_total != null) {
    const pieces = [`${formatBytes(progress.bytes_downloaded)} / ${formatBytes(progress.bytes_total)}`];
    if (progress.bytes_per_second != null) pieces.push(`${formatBytes(progress.bytes_per_second)}/s`);
    if (progress.repo_id) pieces.push(progress.repo_id);
    return pieces.join(" · ");
  }
  if (normalizeProgressStage(progress.stage || "") === "transcriber" && progress.message) {
    const detail = progress.detail || {};
    const audioTime = typeof detail.audio_time_processed === "number" ? detail.audio_time_processed : null;
    const duration = typeof detail.audio_duration === "number" ? detail.audio_duration : null;
    const segments = typeof detail.segments === "number" ? detail.segments : null;
    const parts = [progress.message];
    if (audioTime != null && duration) parts.push(`${audioTime.toFixed(1)}s / ${duration.toFixed(1)}s`);
    if (segments != null) parts.push(`${segments} segments`);
    return parts.join(" · ");
  }
  return progress.message || msg.working;
}

function buildStageSequence(labels: Record<string, string>) {
  return [
    { key: "preflight", label: labels.preflight },
    { key: "model_download", label: labels.modelDownload },
    { key: "splitter", label: labels.splitter },
    { key: "filter", label: labels.filter },
    { key: "transcriber", label: labels.transcriber },
    { key: "parser", label: labels.parser },
    { key: "aligner", label: labels.aligner },
    { key: "writer", label: labels.writer },
  ];
}

function stageStatus(stage: string, currentStage: string, sequence: { key: string; label: string }[], jobStatus?: string, completedStages: string[] = []): "done" | "active" | "idle" | "failed" {
  const normalizedCurrent = normalizeProgressStage(currentStage);
  const normalizedCompleted = completedStages.map(normalizeProgressStage);
  if (normalizedCompleted.includes(stage)) return "done";
  const currentIndex = sequence.findIndex((item) => item.key === normalizedCurrent);
  const index = sequence.findIndex((item) => item.key === stage);
  if (normalizedCurrent === stage) return jobStatus === "failed" ? "failed" : "active";
  if (currentIndex >= 0 && index >= 0 && index < currentIndex) return "done";
  if (jobStatus === "succeeded") return "done";
  return "idle";
}

export const RollerPanel: React.FC<{
  project: ProjectModel | null;
  plainLyrics: string;
  syncedLyrics: string;
  editorMeta: MetaModel;
  onProject: (project: ProjectModel, applyToEditor?: boolean) => void;
  onImportText: (text: string) => void;
}> = ({ project, plainLyrics, syncedLyrics, editorMeta, onProject, onImportText }) => {
  const at = useAutoTimingState();
  const [transcriberModelStoreDefault, setTranscriberModelStoreDefault] = useState("");

  const [batchMode, setBatchMode] = useState<"single" | "batch">("single");
  const [batchProjects, setBatchProjects] = useState<ProjectModel[]>([]);
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [job, setJob] = useState<JobModel | null>(null);
  const [preview, setPreview] = useState<RollPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [message, setMessage, , messageFading, messageType] = useMessage();
  const [busy, setBusy] = useState(false);
  const { lang, prefState } = useContext(appContext, ChangBits.lang | ChangBits.prefState);
  const u = lang.ui;
  const s = lang.settings;
  const trOpt = (key: string) => lang.optionLabels?.[key] || key;

  // Merge UI language into the roll payload so py-roller can set PYROLLER_LANG
  const rollPayload = () => ({ ...at.buildRollPayload(), ui_lang: prefState.lang });

  const inputState = useMemo(
    () => computeInputState(project, plainLyrics, syncedLyrics, at.stages, { noProject: u.selectProject, noAudio: u.noAudio, noLyrics: u.noLyrics, ready: u.ready }),
    [project, plainLyrics, syncedLyrics, at.stages, u.selectProject, u.noAudio, u.noLyrics, u.ready],
  );

  const loadDefaults = async () => {
    try {
      const [settings, runtime] = await Promise.all([
        api.settings(),
        api.autoRollerRuntime().catch(() => null),
      ]);
      if (runtime?.model_store) {
        setTranscriberModelStoreDefault(runtime.model_store);
      }
      at.loadFromSettings(settings);
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
    if (!project) {
      setPreview(null);
      setPreviewError("");
      setPreviewBusy(false);
      return;
    }
    let canceled = false;
    setPreviewBusy(true);
    setPreviewError("");
    const timer = window.setTimeout(async () => {
      try {
        const next = await api.rollPreview(project.project_id, rollPayload());
        if (!canceled) setPreview(next);
      } catch (error) {
        if (!canceled) {
          setPreview(null);
          setPreviewError((error as Error).message);
        }
      } finally {
        if (!canceled) setPreviewBusy(false);
      }
    }, 350);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [project?.project_id, at.buildRollPayload]);

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
          toastPubSub.pub({ type: "success", text: s.autoTiming.finished });
        }
        if (updated.status === "failed") toastPubSub.pub({ type: "error", text: updated.error || s.autoTiming.failed });
        if (updated.status === "canceled") toastPubSub.pub({ type: "warning", text: s.autoTiming.canceled });
      } catch (error) {
        toastPubSub.pub({ type: "error", text: (error as Error).message });
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job, onImportText, onProject, project]);

  const saveAndPreview = async () => {
    if (!project) throw new Error("Create or open a project first.");
    await api.saveEditor(project.project_id, { plain_lyrics: plainLyrics, synced_lyrics: syncedLyrics, metadata: editorMeta });
    const next = await api.rollPreview(project.project_id, rollPayload());
    setPreview(next);
    setPreviewError("");
    return next;
  };

  const start = async () => {
    if (!project) {
      setMessage(s.autoTiming.selectProject, "warning", 4000);
      return;
    }
    if (!inputState.ready) {
      setMessage(inputState.reason, "warning", 4000);
      return;
    }
    setBusy(true);
    setMessage(s.autoTiming.starting, "info", 10000);
    try {
      await saveAndPreview();
      const created = await api.roll(project.project_id, rollPayload());
      setJob(created);
      toastPubSub.pub({ type: "success", text: s.autoTiming.started.replace("{id}", created.job_id) });
    } catch (error) {
      toastPubSub.pub({ type: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setMessage(s.autoTiming.retrying, "info", 10000);
    await start();
  };

  const cancel = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const canceled = await api.cancelJob(job.job_id);
      setJob(canceled);
      toastPubSub.pub({ type: "success", text: s.autoTiming.cancelRequested });
    } catch (error) {
      toastPubSub.pub({ type: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // -- batch ------------------------------------------------------------

  const loadBatchProjects = async () => {
    try {
      const list = await api.listProjects();
      setBatchProjects(list);
    } catch {
      setBatchProjects([]);
    }
  };

  const toggleBatchProject = (id: string) => {
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllBatchProjects = () => {
    setSelectedBatchIds(new Set(batchProjects.map((p) => p.project_id)));
  };

  const deselectAllBatchProjects = () => {
    setSelectedBatchIds(new Set());
  };

  const startBatch = async () => {
    if (selectedBatchIds.size === 0) {
      setMessage(s.autoTiming.selectOneProject, "warning", 4000);
      return;
    }
    setBusy(true);
    setMessage(s.autoTiming.batchStarting, "info", 10000);
    try {
      const payload = { ...rollPayload(), project_ids: [...selectedBatchIds], continue_on_error: true };
      const created = await api.batchRoll(payload);
      setJob(created);
      toastPubSub.pub({ type: "success", text: s.autoTiming.batchStarted.replace("{id}", created.job_id).replace("{count}", String(selectedBatchIds.size)) });
    } catch (error) {
      toastPubSub.pub({ type: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // -- rendering --------------------------------------------------------

  const copyCommand = async () => {
    const text = preview?.command_text || job?.command.join(" ") || "";
    if (!text) return;
    await navigator.clipboard?.writeText(text);
    toastPubSub.pub({ type: "success", text: s.autoTiming.commandCopied });
  };

  const copyLog = async () => {
    if (!job) return;
    await navigator.clipboard?.writeText(job.logs.join("\n") || job.command.join(" "));
    toastPubSub.pub({ type: "success", text: s.autoTiming.logCopied });
  };

  const openJobFolder = async () => {
    if (!job) return;
    try {
      const result = await api.openJobFolder(job.job_id);
      toastPubSub.pub({ type: "success", text: s.autoTiming.openedFolder.replace("{path}", result.path) });
    } catch (error) {
      toastPubSub.pub({ type: "error", text: (error as Error).message });
    }
  };

  const browseModelPath = async () => {
    try {
      const result = await api.selectLocalPath({ mode: "directory", title: "Select transcriber model store", initial_path: at.transcriberModelPath || transcriberModelStoreDefault || null });
      if (!result.canceled && result.path) {
        at.setTranscriberModelPath(result.path);
        toastPubSub.pub({ type: "success", text: s.autoTiming.modelStoreSelected });
      }
    } catch (error) {
      toastPubSub.pub({ type: "error", text: (error as Error).message });
    }
  };


  const stageLabels = { preflight: u.modelPreflight, modelDownload: u.modelDownload, splitter: u.splitter, filter: u.filtering, transcriber: u.transcription, parser: u.lyricsParsing, aligner: u.alignment, writer: u.writer };
  const stageSequence = useMemo(() => buildStageSequence(stageLabels), [stageLabels]);
  const commandPreviewText = formatCommandPreview(preview?.command_text, u.commandPreviewPlaceholder);

  const running = !!job && ["queued", "running"].includes(job.status);
  const startDisabled = busy || running || !inputState.ready;
  const logsOpen = !!job && ["running", "failed", "succeeded", "canceled"].includes(job.status);
  const progress = job?.progress || null;
  const progressPercent = progress?.progress ?? progress?.percent ?? null;
  const progressWidth = typeof progressPercent === "number" && Number.isFinite(progressPercent) ? `${Math.max(0, Math.min(1, progressPercent)) * 100}%` : undefined;
  const showProgress = !!job && ["queued", "running", "succeeded", "failed", "canceled"].includes(job.status);

  return (
    <section className="roller-card">
      <h2>{u.autoTiming}</h2>

      <div className="roller-card-tabs">
        <button className={batchMode === "single" ? "active" : ""} type="button" onClick={() => setBatchMode("single")}>{u.single}</button>
        <button className={batchMode === "batch" ? "active" : ""} type="button" onClick={() => { setBatchMode("batch"); void loadBatchProjects(); }}>{u.batch}</button>
        <span className="roller-card-tabs-slider" data-active={batchMode} />
      </div>

      {batchMode === "batch" && (
        <>
          <div className="roller-section-title">{u.selectProjects}</div>
          {batchProjects.length === 0 && <p className="roller-muted">No projects found. Import audio first.</p>}
          {batchProjects.length > 0 && (
            <>
              <div className="roller-actions compact">
                <button type="button" onClick={selectAllBatchProjects}>{u.selectAll}</button>
                <button type="button" onClick={deselectAllBatchProjects}>{u.deselectAll}</button>
              </div>
              <div className="roller-list" style={{ maxHeight: 160, overflow: "auto", marginTop: 6 }}>
                {batchProjects.map((p) => (
                  <label key={p.project_id} className="roller-checkbox" style={{ padding: "5px 8px", minHeight: "auto", fontSize: "0.78rem" }}>
                    <input type="checkbox" checked={selectedBatchIds.has(p.project_id)} onChange={() => toggleBatchProject(p.project_id)} style={{ marginRight: 8 }} />
                    {p.audio_name || p.project_id}
                  </label>
                ))}
              </div>
              <p className="roller-muted">{u.selected.replace("{n}", String(selectedBatchIds.size))}</p>
            </>
          )}
        </>
      )}

      {batchMode === "single" && (
        <>
          <div className="roller-section-title">{u.inputStatus}</div>
          <div className="roller-input-status">
            <span className={inputState.audioReady ? "status-ok" : "status-missing"}>{u.audio}: {at.includesTranscriber || at.includesSplitter || at.includesFilter ? (inputState.audioReady ? u.ready : u.missing) : u.notNeeded}</span>
            <span className={inputState.lyricsReady ? "status-ok" : "status-missing"}>{u.lyrics}: {at.includesParser ? (inputState.lyricsReady ? u.ready : u.missing) : u.notNeeded}</span>
          </div>
          {!inputState.ready && <p className="roller-warning">{inputState.reason}</p>}
        </>
      )}

      <div className="roller-section-title">{u.parameters}</div>
      <div className="roller-form two-col">
        <label>{s.autoTiming.lyricsLanguage}
          <select value={at.language} onChange={(ev) => at.setLanguage(ev.target.value as Language)}>
            {optionNodes(LANGUAGE_OPTIONS, trOpt)}
          </select>
        </label>
        <label>{s.autoTiming.processingPreset}
          <select value={at.stages} onChange={(ev) => at.setStages(ev.target.value)}>
            {optionNodes(STAGE_OPTIONS, trOpt)}
          </select>
        </label>
        <label>{s.autoTiming.outputFormat}
          <select value={at.writerBackend} onChange={(ev) => at.setWriterBackend(ev.target.value)}>
            {optionNodes(WRITER_OPTIONS, trOpt)}
          </select>
        </label>
        <label>{s.autoTiming.repetitionHandling}
          <select value={at.alignerRepetition} onChange={(ev) => at.setAlignerRepetition(ev.target.value as Repetition)} disabled={!at.includesAligner}>
            {optionNodes(REPETITION_OPTIONS, trOpt)}
          </select>
        </label>
        <label className="field-with-browse">{s.autoTiming.modelStoreLabel}
          <span className="browse-row"><input placeholder={transcriberModelStoreDefault || "rollingpebble model store"} value={at.transcriberModelPath} onChange={(ev) => at.setTranscriberModelPath(ev.target.value)} disabled={!at.includesTranscriber} /><button type="button" onClick={browseModelPath} disabled={!at.includesTranscriber}>{u.browse}</button></span>
        </label>
        <label>{s.autoTiming.spacing}
          <select value={at.writerSpacing} onChange={(ev) => at.setWriterSpacing(ev.target.value)} disabled={!at.includesWriter}>
            {optionNodes(SPACING_OPTIONS, trOpt)}
          </select>
        </label>
      </div>
      <details>
        <summary>{u.advanced}</summary>
        <div className="roller-section-title">{u.pipelineRuntime}</div>
        <div className="roller-form two-col">
          <label>{s.autoTiming.cleanupPolicy}<select value={at.cleanup} onChange={(ev) => at.setCleanup(ev.target.value)}>{optionNodes(CLEANUP_OPTIONS, trOpt)}</select></label>
          <label>{s.autoTiming.logLevel}<select value={at.logLevel} onChange={(ev) => at.setLogLevel(ev.target.value)}>{optionNodes(LOG_LEVEL_OPTIONS, trOpt)}</select></label>
        </div>

        {at.includesTranscriber && (
          <>
            <div className="roller-section-title">{u.modelDownload}</div>
            <div className="roller-form two-col">
              <label>{s.autoTiming.hfXet}<select value={at.hfXet} onChange={(ev) => at.setHfXet(ev.target.value as HfXet)}>{optionNodes(HF_XET_OPTIONS, trOpt)}</select></label>
              <label>{s.autoTiming.proxyUrl}<input placeholder="http://127.0.0.1:7890" value={at.hfProxy} onChange={(ev) => at.setHfProxy(ev.target.value)} /></label>
              <label>{s.autoTiming.metadataTimeout}<input inputMode="numeric" placeholder={trOpt("Library built-in")} value={at.hfEtagTimeout} onChange={(ev) => at.setHfEtagTimeout(ev.target.value)} /></label>
              <label>{s.autoTiming.fileDownloadTimeout}<input inputMode="numeric" placeholder={trOpt("Library built-in")} value={at.hfDownloadTimeout} onChange={(ev) => at.setHfDownloadTimeout(ev.target.value)} /></label>
              <label>{s.autoTiming.maxDownloadWorkers}<input inputMode="numeric" placeholder={trOpt("Library built-in")} value={at.hfMaxWorkers} onChange={(ev) => at.setHfMaxWorkers(ev.target.value)} /></label>
              <label>{s.autoTiming.localCacheMode}<select value={at.localOnly} onChange={(ev) => at.setLocalOnly(ev.target.value as LocalOnly)}>{optionNodes(LOCAL_CACHE_OPTIONS, trOpt)}</select></label>
            </div>
          </>
        )}

        {at.includesSplitter && (
          <>
            <div className="roller-section-title">{u.splitter}</div>
            <div className="roller-form two-col">
              <label>{s.autoTiming.backend}<select value={at.splitterBackend} onChange={(ev) => at.setSplitterBackend(ev.target.value)}>{optionNodes(SPLITTER_BACKEND_OPTIONS, trOpt)}</select></label>
              <label>{s.autoTiming.demucsModel}<select value={at.splitterModel} onChange={(ev) => at.setSplitterModel(ev.target.value)}>{optionNodes(DEMUCS_MODEL_OPTIONS, trOpt)}</select></label>
              <label>{s.autoTiming.device}<select value={at.splitterDevice} onChange={(ev) => at.setSplitterDevice(ev.target.value)}>{optionNodes(DEMUCS_DEVICE_OPTIONS, trOpt)}</select></label>
              <label>{s.autoTiming.jobs}<input inputMode="numeric" placeholder={trOpt("Auto-detect")} value={at.splitterJobs} onChange={(ev) => at.setSplitterJobs(ev.target.value)} /></label>
              <label>{s.autoTiming.overlap}<input inputMode="decimal" placeholder={trOpt("Default")} value={at.splitterOverlap} onChange={(ev) => at.setSplitterOverlap(ev.target.value)} /></label>
              <label>{s.autoTiming.segment}<input inputMode="decimal" placeholder={trOpt("Default")} value={at.splitterSegment} onChange={(ev) => at.setSplitterSegment(ev.target.value)} /></label>
            </div>
          </>
        )}

        {at.includesFilter && (
          <>
            <div className="roller-section-title">{u.filter}</div>
            <div className="roller-form"><label>{u.filterChain}<select value={at.filterChain} onChange={(ev) => at.setFilterChain(ev.target.value)}>{optionNodes(FILTER_CHAIN_OPTIONS, trOpt)}</select></label></div>
          </>
        )}

        {at.includesTranscriber && (
          <>
            <div className="roller-section-title">{u.transcriber}</div>
            <div className="roller-form two-col">
              <label>{s.autoTiming.backend}<select value={at.transcriberBackend} onChange={(ev) => at.setTranscriberBackend(ev.target.value)}>{optionNodes(transcriberBackendOptions(at.language), trOpt)}</select></label>
              <label>{s.autoTiming.device}<select value={at.transcriberDevice} onChange={(ev) => at.setTranscriberDevice(ev.target.value)}>{optionNodes(DEVICE_OPTIONS, trOpt)}</select></label>
              <label>{s.autoTiming.modelName}<select value={at.transcriberModel} onChange={(ev) => at.setTranscriberModel(ev.target.value)}>{optionNodes(transcriberModelOptions(at.language, at.transcriberBackend), trOpt)}</select></label>
              <label>{s.autoTiming.computeType}<select value={at.transcriberComputeType} onChange={(ev) => at.setTranscriberComputeType(ev.target.value)} disabled={!at.transcriberIsFasterWhisper}>{optionNodes(COMPUTE_TYPE_OPTIONS, trOpt)}</select></label>
              <label>{s.autoTiming.batchSize}<input inputMode="numeric" placeholder="8" value={at.transcriberBatchSize} onChange={(ev) => at.setTranscriberBatchSize(ev.target.value)} disabled={!at.transcriberIsFasterWhisper} /></label>
              <label>{s.autoTiming.vadFilter}<select value={at.vadFilter} onChange={(ev) => at.setVadFilter(ev.target.value)}>{optionNodes(VAD_FILTER_OPTIONS, trOpt)}</select></label>
            </div>
          </>
        )}

        {at.includesParser && (
          <>
            <div className="roller-section-title">{u.parser}</div>
            <div className="roller-form"><label>{s.autoTiming.lyricsEncoding}<select value={at.parserEncoding} onChange={(ev) => at.setParserEncoding(ev.target.value)}>{optionNodes(PARSER_ENCODING_OPTIONS, trOpt)}</select></label></div>
          </>
        )}

        {at.includesAligner && (
          <>
            <div className="roller-section-title">{u.aligner}</div>
            <div className="roller-form two-col">
              <label>{s.autoTiming.backend}<select value={at.alignerBackend} onChange={(ev) => at.setAlignerBackend(ev.target.value)}>{optionNodes(ALIGNER_BACKEND_OPTIONS, trOpt)}</select></label>
              <label>{s.autoTiming.minGap}<input inputMode="decimal" placeholder="0.5" value={at.alignerMinGap} onChange={(ev) => at.setAlignerMinGap(ev.target.value)} /></label>
            </div>
          </>
        )}

        {at.includesWriter && (
          <>
            <div className="roller-section-title">{u.writer}</div>
            <div className="roller-form two-col">
              <label>{s.autoTiming.byTag}<input placeholder="RollingPebble" value={at.writerByTag} onChange={(ev) => at.setWriterByTag(ev.target.value)} /></label>
              <label>{s.autoTiming.assKaraokeTag}<select value={at.writerKaraokeTag} onChange={(ev) => at.setWriterKaraokeTag(ev.target.value)} disabled={!at.writerIsAss}>{optionNodes(KARAOKE_TAG_OPTIONS, trOpt)}</select></label>
            </div>
          </>
        )}
      </details>

      {showProgress && (
        <section className="roller-progress-card" aria-live="polite">
          <div className="roller-progress-head">
            <b>{progressStageLabel(progress?.stage || (job?.status === "queued" ? "queued" : "running"), stageLabels, { preparing: u.preparing, complete: u.complete })}</b>
            <span>{typeof progressPercent === "number" ? `${Math.round(progressPercent * 100)}%` : job?.status}</span>
          </div>
          <div className={progressWidth ? "roller-progress-bar" : "roller-progress-bar indeterminate"}>
            <span style={progressWidth ? { width: progressWidth } : undefined} />
          </div>
          <div className="roller-progress-meta">
            <span>{progressMessage(progress, { waiting: u.progressWaiting, working: u.progressWorking })}</span>
            {progress && progress.total > 0 && <em>{progress.completed}/{progress.total} {progress.unit}</em>}
          </div>
          {progress?.cache_dir && <p className="roller-muted progress-cache">Cache: {progress.cache_dir}</p>}
          <ol className="roller-stage-list">
            {stageSequence.map((item) => (
              <li key={item.key} className={`stage-${stageStatus(item.key, progress?.stage || "", job?.status, job?.completed_stages || [])}`}>
                <span />{item.label}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="roller-section-title">{u.run}</div>
      <div className="roller-actions roller-run-actions">
        {batchMode === "single" ? (
          <>
            <button type="button" className="roller-action-start" disabled={startDisabled} onClick={() => void start()}>{u.start}</button>
            <button type="button" className="roller-action-cancel" disabled={!running || busy} onClick={() => void cancel()}>{u.cancel}</button>
            <button type="button" className="roller-action-retry" disabled={busy || running || !project} onClick={() => void retry()}>{u.retry}</button>
          </>
        ) : (
          <>
            <button type="button" className="roller-action-start" disabled={busy || running || selectedBatchIds.size === 0} onClick={() => void startBatch()}>{u.startBatch}</button>
            <button type="button" className="roller-action-cancel" disabled={!running || busy} onClick={() => void cancel()}>{u.cancel}</button>
            <button type="button" className="roller-action-retry" disabled={busy || running || selectedBatchIds.size === 0} onClick={() => void startBatch()}>{u.retry}</button>
          </>
        )}
      </div>
      {batchMode === "single" && startDisabled && !running && <p className="roller-warning">{inputState.reason}</p>}
      {message && <p className={`roller-message ${messageType}${messageFading ? " fading" : ""}`}>{message}</p>}

      {batchMode === "single" && <details>
        <summary>{u.commandPreview}</summary>
        <div className="roller-actions compact">
          <button type="button" disabled={!preview && !job} onClick={() => void copyCommand()}>{u.copyCommand}</button>
        </div>
        {previewBusy && <p className="roller-muted">Updating command preview...</p>}
        {previewError && <p className="roller-warning">{previewError}</p>}
        {preview?.warnings?.map((warning) => <p key={warning} className="roller-warning">{warning}</p>)}
        <pre className="roller-command" aria-label="Command preview"><code>{commandPreviewText}</code></pre>
      </details>}

      {batchMode === "single" && job && (
        <details open={logsOpen}>
          <summary>{`Job ${job.status.charAt(0).toUpperCase()}${job.status.slice(1)}`} · {job.job_id}</summary>
          <div className="roller-actions compact">
            <button type="button" disabled={!job} onClick={() => void copyLog()}>{u.copyLog}</button>
            <button type="button" disabled={!job.project_id} onClick={() => void openJobFolder()}>{u.openJobFolder}</button>
          </div>
          {job.error && <p className="roller-warning">{job.error}</p>}
          <pre className="roller-log">{job.logs.join("\n") || job.command.join(" ")}</pre>
        </details>
      )}
    </section>
  );
};
