export type Language = "zh" | "en" | "mul";
export type Repetition = "none" | "few" | "full";
export type HfXet = "auto" | "on" | "off";
export type LocalOnly = "on" | "off";
export type Spacing = "keep" | "drop";
export type Cleanup = "on-success" | "never";
export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
export type KaraokeTag = "" | "k" | "K" | "kf" | "ko";

export type Option = { value: string; label: string; help?: string; disabled?: boolean };

export const LANGUAGE_OPTIONS: Option[] = [
  { value: "zh", label: "Chinese" },
  { value: "en", label: "English" },
  { value: "mul", label: "Multilingual" },
];

export const STAGE_OPTIONS: Option[] = [
  {
    value: "t,p,a,w",
    label: "Direct timing",
    help: "Transcribe -> Parse -> Align -> Write. Fastest path when the original mix is clear enough.",
  },
  {
    value: "s,f,t,p,a,w",
    label: "Split vocals first",
    help: "Split vocals -> optional Filter -> Transcribe -> Parse -> Align -> Write. Slower, but often more accurate for dense mixes.",
  },
  {
    value: "a,w",
    label: "Reuse recognition and realign",
    help: "Reuse saved timed_units.json and parsed_lyrics.json, then Align -> Write.",
  },
  {
    value: "w",
    label: "Rewrite output only",
    help: "Reuse saved alignment_result.json and only write a new output format.",
  },
];

export const WRITER_OPTIONS: Option[] = [
  { value: "lrc_ms", label: "LRC, millisecond tags" },
  { value: "lrc_cs", label: "LRC, centisecond tags" },
  { value: "lrc_compressed", label: "Compressed LRC" },
  { value: "ass_karaoke", label: "ASS karaoke" },
];

export const SPACING_OPTIONS: Option[] = [
  { value: "keep", label: "Keep original spaces" },
  { value: "drop", label: "Drop extra spaces" },
];

export const REPETITION_OPTIONS: Option[] = [
  { value: "none", label: "None / standard alignment" },
  { value: "few", label: "Few repeated regions" },
  { value: "full", label: "Highly repetitive song" },
];

export const CLEANUP_OPTIONS: Option[] = [
  { value: "never", label: "Keep intermediate files" },
  { value: "on-success", label: "Clean on success" },
];

export const LOG_LEVEL_OPTIONS: Option[] = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].map((value) => ({ value, label: value }));

export const SPLITTER_BACKEND_OPTIONS: Option[] = [
  { value: "demucs", label: "Demucs" },
];

export const DEMUCS_MODEL_OPTIONS: Option[] = [
  { value: "htdemucs", label: "htdemucs" },
  { value: "htdemucs_ft", label: "htdemucs_ft" },
  { value: "htdemucs_6s", label: "htdemucs_6s" },
  { value: "hdemucs_mmi", label: "hdemucs_mmi" },
  { value: "mdx_extra", label: "mdx_extra" },
  { value: "mdx_extra_q", label: "mdx_extra_q" },
];

export const DEMUCS_DEVICE_OPTIONS: Option[] = [
  { value: "", label: "Let Demucs choose" },
  { value: "cpu", label: "CPU" },
  { value: "cuda", label: "CUDA" },
  { value: "mps", label: "Apple Silicon / MPS" },
];

export const FILTER_CHAIN_OPTIONS: Option[] = [
  { value: "", label: "No filter chain" },
  { value: "noise_gate", label: "Noise gate" },
  { value: "dereverb", label: "Dereverb" },
  { value: "noise_gate,dereverb", label: "Noise gate -> dereverb" },
  { value: "dereverb,noise_gate", label: "Dereverb -> noise gate" },
];

export const DEVICE_OPTIONS: Option[] = [
  { value: "", label: "Auto / py-roller default" },
  { value: "cpu", label: "CPU" },
  { value: "cuda", label: "CUDA" },
  { value: "mps", label: "Apple Silicon / MPS (Torch backends)" },
];

export const FASTER_WHISPER_MODEL_OPTIONS: Option[] = [
  { value: "large-v2", label: "large-v2" },
  { value: "large-v3", label: "large-v3" },
  { value: "turbo", label: "turbo" },
];

export const COMPUTE_TYPE_OPTIONS: Option[] = [
  { value: "int8", label: "int8" },
  { value: "float16", label: "float16" },
  { value: "float32", label: "float32" },
  { value: "int8_float16", label: "int8_float16" },
];

export const HF_XET_OPTIONS: Option[] = [
  { value: "auto", label: "Auto" },
  { value: "off", label: "Off, safer network path" },
  { value: "on", label: "On" },
];

export const PARSER_ENCODING_OPTIONS: Option[] = [
  { value: "auto", label: "Auto" },
  { value: "utf-8", label: "UTF-8" },
  { value: "utf-8-sig", label: "UTF-8 BOM" },
  { value: "utf-16", label: "UTF-16" },
  { value: "gbk", label: "GBK" },
  { value: "gb18030", label: "GB18030" },
  { value: "shift-jis", label: "Shift-JIS" },
];

export const ALIGNER_BACKEND_OPTIONS: Option[] = [
  { value: "global_dp_v1", label: "global_dp_v1" },
];

export const KARAOKE_TAG_OPTIONS: Option[] = [
  { value: "kf", label: "kf" },
  { value: "k", label: "k" },
  { value: "K", label: "K" },
  { value: "ko", label: "ko" },
];

export function stageSet(stages: string): Set<string> {
  return new Set(stages.split(",").map((item) => item.trim()).filter(Boolean));
}

export function includesStage(stages: string, stage: "s" | "f" | "t" | "p" | "a" | "w"): boolean {
  return stageSet(stages).has(stage);
}

export function normalizeTranscriberDevice(device: string): string {
  const allowed = DEVICE_OPTIONS.map((item) => item.value);
  return allowed.includes(device) ? device : "cpu";
}

export function transcriberBackendOptions(language: Language): Option[] {
  if (language === "zh") {
    return [
      { value: "faster_whisper", label: "faster_whisper" },
      { value: "mms_phonetic", label: "mms_phonetic" },
    ];
  }
  if (language === "mul") {
    return [
      { value: "faster_whisper", label: "faster_whisper" },
      { value: "wav2vec2_phoneme", label: "wav2vec2_phoneme" },
    ];
  }
  return [{ value: "faster_whisper", label: "faster_whisper" }];
}

export function normalizeTranscriberBackend(language: Language, backend: string): string {
  const allowed = transcriberBackendOptions(language).map((item) => item.value);
  return allowed.includes(backend) ? backend : "faster_whisper";
}

export function transcriberModelOptions(language: Language, backend: string): Option[] {
  const normalized = normalizeTranscriberBackend(language, backend);
  if (normalized === "mms_phonetic") {
    return [{ value: "Chuatury/wav2vec2-mms-1b-cmn-phonetic", label: "Chinese MMS phonetic" }];
  }
  if (normalized === "wav2vec2_phoneme") {
    return [{ value: "facebook/wav2vec2-lv-60-espeak-cv-ft", label: "Multilingual wav2vec2 phoneme" }];
  }
  return FASTER_WHISPER_MODEL_OPTIONS;
}

export function defaultModelFor(language: Language, backend: string): string {
  return transcriberModelOptions(language, backend)[0]?.value || "large-v2";
}

export function isFasterWhisper(backend: string): boolean {
  return backend === "faster_whisper";
}
