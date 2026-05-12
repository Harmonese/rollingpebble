import { useEffect, useMemo, useState } from "react";
import {
  api,
  type JobModel,
  type MetaModel,
  type ProjectModel,
  type RollPreview,
} from "../../shared/api.js";
import { hasLyricContent } from "../../shared/lrc.js";

const STAGE_OPTIONS = [
  {
    value: "t,p,a,w",
    label: "Quick timing",
    help: "Transcribe -> Parse -> Align -> Write",
  },
  {
    value: "s,f,t,p,a,w",
    label: "Full processing",
    help: "Split vocals -> Filter -> Transcribe -> Parse -> Align -> Write",
  },
];

const WRITER_OPTIONS = [
  { value: "lrc_ms", label: "LRC, millisecond tags" },
  { value: "lrc_cs", label: "LRC, centisecond tags" },
  { value: "lrc_compressed", label: "Compressed LRC" },
];

type HfXetOverride = "" | "auto" | "on" | "off";
type LocalOnlyOverride = "" | "on" | "off";

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
    return {
      ready: false,
      audioReady,
      lyricsReady,
      reason: "Create or open a project first.",
    };
  }
  if (!audioReady) {
    return {
      ready: false,
      audioReady,
      lyricsReady,
      reason: "This project has no audio file.",
    };
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

function formatProgressPercent(percent?: number | null): string {
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    return "";
  }
  return `${Math.round(Math.max(0, Math.min(1, percent)) * 100)}%`;
}

function progressStageLabel(stage: string): string {
  if (!stage) return "Preparing";
  return stage
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export const RollerPanel: React.FC<{
  project: ProjectModel | null;
  plainLyrics: string;
  syncedLyrics: string;
  editorMeta: MetaModel;
  onProject: (project: ProjectModel, applyToEditor?: boolean) => void;
  onImportText: (text: string) => void;
}> = ({
  project,
  plainLyrics,
  syncedLyrics,
  editorMeta,
  onProject,
  onImportText,
}) => {
  const [language, setLanguage] = useState<"zh" | "en" | "mul">("zh");
  const [stages, setStages] = useState("t,p,a,w");
  const [writerBackend, setWriterBackend] = useState("lrc_ms");
  const [writerSpacing, setWriterSpacing] = useState("keep");
  const [cleanup, setCleanup] = useState("never");
  const [parserEncoding, setParserEncoding] = useState("");
  const [transcriberBackend, setTranscriberBackend] = useState("");
  const [transcriberDevice, setTranscriberDevice] = useState("");
  const [transcriberModel, setTranscriberModel] = useState("");
  const [transcriberModelPath, setTranscriberModelPath] = useState("");
  const [localOnly, setLocalOnly] = useState<LocalOnlyOverride>("");
  const [hfXet, setHfXet] = useState<HfXetOverride>("");
  const [hfProxy, setHfProxy] = useState("");
  const [hfEtagTimeout, setHfEtagTimeout] = useState("");
  const [hfDownloadTimeout, setHfDownloadTimeout] = useState("");
  const [hfMaxWorkers, setHfMaxWorkers] = useState("");
  const [job, setJob] = useState<JobModel | null>(null);
  const [preview, setPreview] = useState<RollPreview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const inputState = useMemo(
    () => computeInputState(project, plainLyrics, syncedLyrics),
    [project, plainLyrics, syncedLyrics],
  );

  const rollPayload = useMemo(
    () => ({
      language,
      stages,
      writer_backend: writerBackend,
      writer_spacing: writerSpacing,
      cleanup,
      parser_lyrics_encoding: parserEncoding || null,
      transcriber_backend: transcriberBackend || null,
      transcriber_device: transcriberDevice || null,
      transcriber_model_name: transcriberModel || null,
      transcriber_model_path: transcriberModelPath.trim() || null,
      transcriber_local_files_only:
        localOnly === "" ? null : localOnly === "on",
      transcriber_hf_xet: hfXet || null,
      transcriber_hf_proxy: hfProxy.trim() || null,
      transcriber_hf_etag_timeout: optionalNumberValue(hfEtagTimeout),
      transcriber_hf_download_timeout: optionalNumberValue(hfDownloadTimeout),
      transcriber_hf_max_workers: optionalNumberValue(hfMaxWorkers),
    }),
    [
      cleanup,
      hfDownloadTimeout,
      hfEtagTimeout,
      hfMaxWorkers,
      hfProxy,
      hfXet,
      language,
      localOnly,
      parserEncoding,
      stages,
      transcriberBackend,
      transcriberDevice,
      transcriberModel,
      transcriberModelPath,
      writerBackend,
      writerSpacing,
    ],
  );

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
          setMessage(
            "Automatic timing finished and imported the generated LRC.",
          );
        }
        if (updated.status === "failed") {
          setMessage(updated.error || "Automatic timing failed.");
        }
        if (updated.status === "canceled") {
          setMessage("Automatic timing was canceled.");
        }
      } catch (error) {
        setMessage((error as Error).message);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job, onImportText, onProject, project]);

  const saveAndPreview = async () => {
    if (!project) throw new Error("Create or open a project first.");
    await api.saveEditor(project.project_id, {
      plain_lyrics: plainLyrics,
      synced_lyrics: syncedLyrics,
      metadata: editorMeta,
    });
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
    await navigator.clipboard?.writeText(
      job.logs.join("\n") || job.command.join(" "),
    );
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

  const running = !!job && ["queued", "running"].includes(job.status);
  const selectedStage = STAGE_OPTIONS.find((item) => item.value === stages);
  const startDisabled = busy || running || !inputState.ready;
  const logsOpen =
    !!job &&
    ["running", "failed", "succeeded", "canceled"].includes(job.status);
  const progress = job?.progress || null;
  const progressPercent = progress?.percent ?? null;
  const progressWidth =
    typeof progressPercent === "number" && Number.isFinite(progressPercent)
      ? `${Math.max(0, Math.min(1, progressPercent)) * 100}%`
      : undefined;
  const showProgress = !!job && ["queued", "running", "succeeded", "failed", "canceled"].includes(job.status);

  const useSaferDownload = () => {
    setLocalOnly("");
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

  const clearDownloadOverrides = () => {
    setLocalOnly("");
    setHfXet("");
    setHfProxy("");
    setHfEtagTimeout("");
    setHfDownloadTimeout("");
    setHfMaxWorkers("");
    setMessage("Download overrides cleared for this run.");
  };


  const browseModelPath = async () => {
    try {
      const result = await api.selectLocalPath({
        mode: "directory",
        title: "Select model folder",
        initial_path: transcriberModelPath || null,
      });
      if (!result.canceled && result.path) {
        setTranscriberModelPath(result.path);
        setMessage("Model path selected.");
      }
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  return (
    <section className="roller-card">
      <h2>Auto Timing</h2>
      <p className="roller-muted">Generate synced lyrics from this song.</p>

      <div className="roller-section-title">Input status</div>
      <div className="roller-input-status">
        <span
          className={inputState.audioReady ? "status-ok" : "status-missing"}
        >
          Audio: {inputState.audioReady ? "ready" : "missing"}
        </span>
        <span
          className={inputState.lyricsReady ? "status-ok" : "status-missing"}
        >
          Lyrics: {inputState.lyricsReady ? "ready" : "missing"}
        </span>
      </div>
      {!inputState.ready && (
        <p className="roller-warning">{inputState.reason}</p>
      )}

      <div className="roller-section-title">Basic settings</div>
      <div className="roller-form two-col">
        <label>
          Lyrics language
          <select
            value={language}
            onChange={(ev) =>
              setLanguage(ev.target.value as "zh" | "en" | "mul")
            }
          >
            <option value="zh">Chinese</option>
            <option value="en">English</option>
            <option value="mul">Multilingual</option>
          </select>
        </label>
        <label>
          Processing preset
          <select value={stages} onChange={(ev) => setStages(ev.target.value)}>
            {STAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Output format
          <select
            value={writerBackend}
            onChange={(ev) => setWriterBackend(ev.target.value)}
          >
            {WRITER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Spacing
          <select
            value={writerSpacing}
            onChange={(ev) => setWriterSpacing(ev.target.value)}
          >
            <option value="keep">Keep original spaces</option>
            <option value="drop">Drop extra spaces</option>
          </select>
        </label>
      </div>
      {selectedStage && <p className="roller-muted">{selectedStage.help}</p>}

      <details>
        <summary>Advanced task parameters</summary>
        <div className="roller-form two-col">
          <label>
            Cleanup policy
            <select
              value={cleanup}
              onChange={(ev) => setCleanup(ev.target.value)}
            >
              <option value="never">Keep intermediate files</option>
              <option value="on-success">Clean on success</option>
            </select>
          </label>
          <label>
            Lyrics encoding
            <select
              value={parserEncoding}
              onChange={(ev) => setParserEncoding(ev.target.value)}
            >
              <option value="">Default</option>
              <option value="auto">Auto</option>
              <option value="utf-8">UTF-8</option>
              <option value="utf-8-sig">UTF-8 BOM</option>
              <option value="utf-16">UTF-16</option>
              <option value="gbk">GBK</option>
              <option value="gb18030">GB18030</option>
              <option value="shift-jis">Shift-JIS</option>
            </select>
          </label>
          <label>
            Transcriber backend
            <input
              placeholder="default"
              value={transcriberBackend}
              onChange={(ev) => setTranscriberBackend(ev.target.value)}
            />
          </label>
          <label>
            Device
            <input
              placeholder="auto / cpu / cuda"
              value={transcriberDevice}
              onChange={(ev) => setTranscriberDevice(ev.target.value)}
            />
          </label>
          <label>
            Model name
            <input
              placeholder="default"
              value={transcriberModel}
              onChange={(ev) => setTranscriberModel(ev.target.value)}
            />
          </label>
          <label className="field-with-browse">
            Model path
            <span className="browse-row">
              <input
                placeholder="default py-roller model store"
                value={transcriberModelPath}
                onChange={(ev) => setTranscriberModelPath(ev.target.value)}
              />
              <button type="button" onClick={browseModelPath}>Browse</button>
            </span>
          </label>
          <label>
            Local cache mode
            <select
              value={localOnly}
              onChange={(ev) => setLocalOnly(ev.target.value as LocalOnlyOverride)}
            >
              <option value="">Use Settings default</option>
              <option value="off">Allow download if missing</option>
              <option value="on">Use local cache only</option>
            </select>
          </label>
        </div>

        <div className="roller-section-title">Model download</div>
        <div className="roller-form two-col">
          <label>
            HF XET / CAS
            <select
              value={hfXet}
              onChange={(ev) => setHfXet(ev.target.value as HfXetOverride)}
            >
              <option value="">Use Settings default</option>
              <option value="auto">Auto</option>
              <option value="off">Off, safer network path</option>
              <option value="on">On</option>
            </select>
          </label>
          <label>
            Proxy URL
            <input
              placeholder="http://127.0.0.1:7890"
              value={hfProxy}
              onChange={(ev) => setHfProxy(ev.target.value)}
            />
          </label>
          <label>
            Metadata timeout, seconds
            <input
              inputMode="decimal"
              placeholder="default"
              value={hfEtagTimeout}
              onChange={(ev) => setHfEtagTimeout(ev.target.value)}
            />
          </label>
          <label>
            File download timeout, seconds
            <input
              inputMode="decimal"
              placeholder="default"
              value={hfDownloadTimeout}
              onChange={(ev) => setHfDownloadTimeout(ev.target.value)}
            />
          </label>
          <label>
            Max download workers
            <input
              inputMode="numeric"
              placeholder="default"
              value={hfMaxWorkers}
              onChange={(ev) => setHfMaxWorkers(ev.target.value)}
            />
          </label>
        </div>
        <div className="roller-actions download-presets">
          <button type="button" onClick={useSaferDownload}>Safer download</button>
          <button type="button" onClick={useOfflineCache}>Offline cache</button>
          <button type="button" onClick={clearDownloadOverrides}>Clear overrides</button>
        </div>
      </details>

      <div className="roller-section-title">Run</div>
      {job && (
        <span className="roller-status-pill">
          {job.kind} · {job.status}
        </span>
      )}
      {showProgress && (
        <div className="roller-progress-card" aria-live="polite">
          <div className="roller-progress-head">
            <span>
              {progress ? progressStageLabel(progress.stage) : "Waiting for progress"}
            </span>
            <b>
              {progress
                ? formatProgressPercent(progress.percent) ||
                  (progress.total > 0
                    ? `${progress.completed}/${progress.total} ${progress.unit}`
                    : "working")
                : "working"}
            </b>
          </div>
          <div
            className={
              progressWidth
                ? "roller-progress-bar"
                : "roller-progress-bar indeterminate"
            }
          >
            <span style={progressWidth ? { width: progressWidth } : undefined} />
          </div>
          <div className="roller-progress-meta">
            {progress?.message ||
              (job.status === "queued"
                ? "Queued."
                : "Waiting for timing progress output...")}
            {progress?.total ? (
              <em>
                {progress.unit === "%"
                  ? `${progress.completed}%`
                  : `${progress.completed}/${progress.total} ${progress.unit}`}
              </em>
            ) : null}
          </div>
        </div>
      )}
      <div className="roller-actions">
        <button
          type="button"
          disabled={startDisabled}
          title={startDisabled ? inputState.reason : ""}
          onClick={start}
        >
          Start
        </button>
        <button
          type="button"
          disabled={busy || !project}
          onClick={refreshPreview}
        >
          Preview command
        </button>
        <button type="button" disabled={!running || busy} onClick={cancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || running || !project}
          onClick={retry}
        >
          Retry
        </button>
        <button type="button" disabled={!preview && !job} onClick={copyCommand}>
          Copy command
        </button>
        <button type="button" disabled={!job} onClick={copyLog}>
          Copy log
        </button>
        <button type="button" disabled={!project} onClick={openProjectFolder}>
          Open folder
        </button>
        <button
          type="button"
          disabled={!job?.result?.synced_lyrics}
          onClick={importResult}
        >
          Import result
        </button>
      </div>
      {message && <p className="roller-message">{message}</p>}

      <details open={!!preview}>
        <summary>Command preview</summary>
        {preview?.warnings.length ? (
          <p className="roller-warning">{preview.warnings.join(" ")}</p>
        ) : null}
        <pre className="command-preview">
          {preview?.command_text || "Preview the command before running."}
        </pre>
      </details>

      {job && (
        <details open={logsOpen}>
          <summary>
            Task log · {job.job_id} · {job.status}
          </summary>
          <pre className="roller-log">
            {job.logs.join("\n") || job.command.join(" ")}
          </pre>
          {job.error && <p className="roller-warning">{job.error}</p>}
        </details>
      )}
    </section>
  );
};
