import { useCallback, useEffect, useState } from "react";
import { optionalNumber, optionalNumberValue, optionalPositiveInt, optionalPositiveIntValue, textFromOptionalNumber } from "../shared/numbers.js";
import {
    includesStage,
    isFasterWhisper,
    normalizeStages,
    normalizeTranscriberBackend,
    normalizeTranscriberDevice,
    transcriberModelOptions,
    defaultModelFor,
    type HfXet,
    type Language,
    type LocalOnly,
    type Repetition,
} from "../features/roller/autoTimingOptions.js";

export interface AutoTimingState {
    language: Language;
    stages: string;
    writerBackend: string;
    writerSpacing: string;
    writerByTag: string;
    writerKaraokeTag: string;
    cleanup: string;
    logLevel: string;
    splitterBackend: string;
    splitterModel: string;
    splitterDevice: string;
    splitterJobs: string;
    splitterOverlap: string;
    splitterSegment: string;
    filterChain: string;
    transcriberBackend: string;
    transcriberDevice: string;
    transcriberModel: string;
    transcriberComputeType: string;
    transcriberBatchSize: string;
    localOnly: LocalOnly;
    hfXet: HfXet;
    hfProxy: string;
    hfEtagTimeout: string;
    hfDownloadTimeout: string;
    hfMaxWorkers: string;
    vadFilter: string;
    parserEncoding: string;
    alignerBackend: string;
    alignerMinGap: string;
    alignerRepetition: Repetition;
}

export interface AutoTimingSetters {
    setLanguage: (v: Language) => void;
    setStages: (v: string) => void;
    setWriterBackend: (v: string) => void;
    setWriterSpacing: (v: string) => void;
    setWriterByTag: (v: string) => void;
    setWriterKaraokeTag: (v: string) => void;
    setCleanup: (v: string) => void;
    setLogLevel: (v: string) => void;
    setSplitterBackend: (v: string) => void;
    setSplitterModel: (v: string) => void;
    setSplitterDevice: (v: string) => void;
    setSplitterJobs: (v: string) => void;
    setSplitterOverlap: (v: string) => void;
    setSplitterSegment: (v: string) => void;
    setFilterChain: (v: string) => void;
    setTranscriberBackend: (v: string) => void;
    setTranscriberDevice: (v: string) => void;
    setTranscriberModel: (v: string) => void;
    setTranscriberComputeType: (v: string) => void;
    setTranscriberBatchSize: (v: string) => void;
    setLocalOnly: (v: LocalOnly) => void;
    setHfXet: (v: HfXet) => void;
    setHfProxy: (v: string) => void;
    setHfEtagTimeout: (v: string) => void;
    setHfDownloadTimeout: (v: string) => void;
    setHfMaxWorkers: (v: string) => void;
    setVadFilter: (v: string) => void;
    setParserEncoding: (v: string) => void;
    setAlignerBackend: (v: string) => void;
    setAlignerMinGap: (v: string) => void;
    setAlignerRepetition: (v: Repetition) => void;
}

export interface AutoTimingHook extends AutoTimingState, AutoTimingSetters {
    includesSplitter: boolean;
    includesFilter: boolean;
    includesTranscriber: boolean;
    includesParser: boolean;
    includesAligner: boolean;
    includesWriter: boolean;
    transcriberIsFasterWhisper: boolean;
    writerIsAss: boolean;
    loadFromSettings: (settings: Record<string, unknown>, modelStoreDefault?: string) => void;
    buildRollPayload: () => Record<string, unknown>;
    buildSettingsPayload: () => Record<string, unknown>;
}

export function useAutoTimingState(): AutoTimingHook {
    const [language, setLanguage] = useState<Language>("zh");
    const [stages, setStages] = useState("s,f,t,p,a,w");
    const [writerBackend, setWriterBackend] = useState("lrc_ms");
    const [writerSpacing, setWriterSpacing] = useState("keep");
    const [writerByTag, setWriterByTag] = useState("RollingPebble");
    const [writerKaraokeTag, setWriterKaraokeTag] = useState("kf");
    const [cleanup, setCleanup] = useState("on-success");
    const [logLevel, setLogLevel] = useState("INFO");
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
    const [vadFilter, setVadFilter] = useState("off");
    const [parserEncoding, setParserEncoding] = useState("auto");
    const [alignerBackend, setAlignerBackend] = useState("global_dp_v1");
    const [alignerMinGap, setAlignerMinGap] = useState("0.5");
    const [alignerRepetition, setAlignerRepetition] = useState<Repetition>("none");

    const includesSplitter = includesStage(stages, "s");
    const includesFilter = includesStage(stages, "f");
    const includesTranscriber = includesStage(stages, "t");
    const includesParser = includesStage(stages, "p");
    const includesAligner = includesStage(stages, "a");
    const includesWriter = includesStage(stages, "w");
    const transcriberIsFasterWhisper = isFasterWhisper(transcriberBackend);
    const writerIsAss = writerBackend === "ass_karaoke";

    // Normalize transcriber backend/model when language or backend changes
    useEffect(() => {
        const normalized = normalizeTranscriberBackend(language, transcriberBackend);
        if (normalized !== transcriberBackend) {
            setTranscriberBackend(normalized);
            setTranscriberModel(defaultModelFor(language, normalized));
            return;
        }
        const allowedModels = transcriberModelOptions(language, normalized).map((o) => o.value);
        if (!allowedModels.includes(transcriberModel)) {
            setTranscriberModel(defaultModelFor(language, normalized));
        }
    }, [language, transcriberBackend, transcriberModel]);

    const loadFromSettings = useCallback((settings: Record<string, unknown>, modelStoreDefault?: string) => {
        const s = settings as Record<string, unknown>;
        const lang = (s.auto_timing_default_language as Language) || "zh";
        const backend = normalizeTranscriberBackend(lang, (s.auto_timing_transcriber_backend as string) || "faster_whisper");

        setLanguage(lang);
        setStages(normalizeStages((s.auto_timing_default_stages as string) || "s,f,t,p,a,w"));
        setWriterBackend((s.auto_timing_default_writer_backend as string) || "lrc_ms");
        setWriterSpacing((s.auto_timing_default_writer_spacing as string) || "keep");
        setCleanup((s.auto_timing_default_cleanup as string) || "on-success");
        setLogLevel((s.auto_timing_default_log_level as string) || "INFO");
        setSplitterBackend((s.auto_timing_splitter_backend as string) || "demucs");
        setSplitterModel((s.auto_timing_splitter_demucs_model as string) || "htdemucs");
        setSplitterDevice((s.auto_timing_splitter_demucs_device as string) || "");
        setSplitterJobs(textFromOptionalNumber(s.auto_timing_splitter_demucs_jobs as number | null | undefined));
        setSplitterOverlap(textFromOptionalNumber(s.auto_timing_splitter_demucs_overlap as number | null | undefined));
        setSplitterSegment(textFromOptionalNumber(s.auto_timing_splitter_demucs_segment as number | null | undefined));
        setFilterChain((s.auto_timing_filter_chain as string) || "");
        setTranscriberBackend(backend);
        setTranscriberDevice(normalizeTranscriberDevice((s.auto_timing_transcriber_device as string) || "cpu"));
        setTranscriberModel((s.auto_timing_transcriber_model_name as string) || defaultModelFor(lang, backend));
        setTranscriberComputeType((s.auto_timing_transcriber_compute_type as string) || "int8");
        setTranscriberBatchSize(textFromOptionalNumber(s.auto_timing_transcriber_batch_size as number | null | undefined) || "8");
        setLocalOnly(s.auto_timing_local_files_only_default ? "on" : "off");
        setHfXet((s.auto_timing_hf_xet as HfXet) || "auto");
        setHfProxy((s.auto_timing_hf_proxy as string) || "");
        setHfEtagTimeout(textFromOptionalNumber(s.auto_timing_hf_etag_timeout as number | null | undefined));
        setHfDownloadTimeout(textFromOptionalNumber(s.auto_timing_hf_download_timeout as number | null | undefined));
        setHfMaxWorkers(textFromOptionalNumber(s.auto_timing_hf_max_workers as number | null | undefined));
        setVadFilter(s.auto_timing_transcriber_vad_filter ? "on" : "off");
        setParserEncoding((s.auto_timing_parser_lyrics_encoding as string) || "auto");
        setAlignerBackend((s.auto_timing_aligner_backend as string) || "global_dp_v1");
        setAlignerMinGap(textFromOptionalNumber(s.auto_timing_aligner_min_gap as number | null | undefined) || "0.5");
        setAlignerRepetition((s.auto_timing_aligner_repetition as Repetition) || "none");
        const byTag = (s.auto_timing_writer_by_tag as string) || "RollingPebble";
        setWriterByTag(byTag === "py-roller" || byTag === "LRC Roller" ? "RollingPebble" : byTag);
        setWriterKaraokeTag((s.auto_timing_writer_ass_karaoke_tag_type as string) || "kf");

        if (modelStoreDefault) {
            // Provide the runtime model store default if not explicitly set in settings
        }
    }, []);

    const buildRollPayload = useCallback((): Record<string, unknown> => {
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
            payload.splitter_demucs_jobs = optionalPositiveIntValue(splitterJobs);
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
            payload.transcriber_local_files_only = localOnly === "on";
            payload.transcriber_hf_xet = hfXet;
            payload.transcriber_hf_proxy = hfProxy.trim() || null;
            payload.transcriber_hf_etag_timeout = optionalPositiveIntValue(hfEtagTimeout);
            payload.transcriber_hf_download_timeout = optionalPositiveIntValue(hfDownloadTimeout);
            payload.transcriber_hf_max_workers = optionalPositiveIntValue(hfMaxWorkers);
            payload.transcriber_vad_filter = vadFilter === "on";
            payload.transcriber_compute_type = transcriberIsFasterWhisper ? transcriberComputeType : null;
            payload.transcriber_batch_size = transcriberIsFasterWhisper ? optionalPositiveIntValue(transcriberBatchSize) : null;
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
    }, [
        alignerBackend, alignerMinGap, alignerRepetition, cleanup, filterChain,
        hfDownloadTimeout, hfEtagTimeout, hfMaxWorkers, hfProxy, hfXet,
        includesAligner, includesFilter, includesParser, includesSplitter,
        includesTranscriber, includesWriter, language, localOnly, logLevel,
        parserEncoding, splitterBackend, splitterDevice, splitterJobs,
        splitterModel, splitterOverlap, splitterSegment, stages,
        transcriberBackend, transcriberBatchSize, transcriberComputeType,
        transcriberDevice, transcriberIsFasterWhisper, transcriberModel,
        vadFilter, writerBackend, writerByTag,
        writerIsAss, writerKaraokeTag, writerSpacing,
    ]);

    const buildSettingsPayload = useCallback((): Record<string, unknown> => {
        return {
            auto_timing_default_language: language,
            auto_timing_default_stages: stages,
            auto_timing_default_writer_backend: writerBackend,
            auto_timing_default_writer_spacing: writerSpacing,
            auto_timing_default_cleanup: cleanup,
            auto_timing_default_log_level: logLevel,
            auto_timing_splitter_backend: splitterBackend,
            auto_timing_splitter_demucs_model: splitterModel,
            auto_timing_splitter_demucs_device: splitterDevice,
            auto_timing_splitter_demucs_jobs: optionalPositiveInt(splitterJobs),
            auto_timing_splitter_demucs_overlap: optionalNumber(splitterOverlap),
            auto_timing_splitter_demucs_segment: optionalNumber(splitterSegment),
            auto_timing_filter_chain: filterChain,
            auto_timing_transcriber_backend: transcriberBackend,
            auto_timing_transcriber_device: transcriberDevice,
            auto_timing_transcriber_model_name: transcriberModel,
            auto_timing_model_store: "",
            auto_timing_transcriber_compute_type: transcriberIsFasterWhisper ? transcriberComputeType : "",
            auto_timing_transcriber_batch_size: transcriberIsFasterWhisper ? optionalPositiveInt(transcriberBatchSize) : null,
            auto_timing_local_files_only_default: localOnly === "on",
            auto_timing_hf_xet: hfXet,
            auto_timing_hf_proxy: hfProxy.trim(),
            auto_timing_hf_etag_timeout: optionalPositiveInt(hfEtagTimeout),
            auto_timing_hf_download_timeout: optionalPositiveInt(hfDownloadTimeout),
            auto_timing_hf_max_workers: optionalPositiveInt(hfMaxWorkers),
            auto_timing_transcriber_vad_filter: vadFilter === "on",
            auto_timing_parser_lyrics_encoding: parserEncoding,
            auto_timing_aligner_backend: alignerBackend,
            auto_timing_aligner_min_gap: optionalNumber(alignerMinGap),
            auto_timing_aligner_repetition: alignerRepetition,
            auto_timing_writer_by_tag: writerByTag.trim(),
            auto_timing_writer_ass_karaoke_tag_type: writerIsAss ? writerKaraokeTag : "",
        };
    }, [
        alignerBackend, alignerMinGap, alignerRepetition, cleanup, filterChain,
        hfDownloadTimeout, hfEtagTimeout, hfMaxWorkers, hfProxy, hfXet,
        language, localOnly, logLevel, parserEncoding, splitterBackend,
        splitterDevice, splitterJobs, splitterModel, splitterOverlap,
        splitterSegment, stages, transcriberBackend, transcriberBatchSize,
        transcriberComputeType, transcriberDevice, transcriberIsFasterWhisper,
        transcriberModel, vadFilter, writerBackend,
        writerByTag, writerIsAss, writerKaraokeTag, writerSpacing,
    ]);

    return {
        language, setLanguage,
        stages, setStages,
        writerBackend, setWriterBackend,
        writerSpacing, setWriterSpacing,
        writerByTag, setWriterByTag,
        writerKaraokeTag, setWriterKaraokeTag,
        cleanup, setCleanup,
        logLevel, setLogLevel,
        splitterBackend, setSplitterBackend,
        splitterModel, setSplitterModel,
        splitterDevice, setSplitterDevice,
        splitterJobs, setSplitterJobs,
        splitterOverlap, setSplitterOverlap,
        splitterSegment, setSplitterSegment,
        filterChain, setFilterChain,
        transcriberBackend, setTranscriberBackend,
        transcriberDevice, setTranscriberDevice,
        transcriberModel, setTranscriberModel,
        transcriberComputeType, setTranscriberComputeType,
        transcriberBatchSize, setTranscriberBatchSize,
        localOnly, setLocalOnly,
        hfXet, setHfXet,
        hfProxy, setHfProxy,
        hfEtagTimeout, setHfEtagTimeout,
        hfDownloadTimeout, setHfDownloadTimeout,
        hfMaxWorkers, setHfMaxWorkers,
        vadFilter, setVadFilter,
        parserEncoding, setParserEncoding,
        alignerBackend, setAlignerBackend,
        alignerMinGap, setAlignerMinGap,
        alignerRepetition, setAlignerRepetition,
        includesSplitter,
        includesFilter,
        includesTranscriber,
        includesParser,
        includesAligner,
        includesWriter,
        transcriberIsFasterWhisper,
        writerIsAss,
        loadFromSettings,
        buildRollPayload,
        buildSettingsPayload,
    };
}
