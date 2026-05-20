import type React from "react";
import type { AutoTimingHook } from "../../hooks/useAutoTimingState.js";
import { optionNodes } from "../../shared/optionNodes.js";
import {
    ALIGNER_BACKEND_OPTIONS,
    type Cleanup,
    CLEANUP_OPTIONS,
    COMPUTE_TYPE_OPTIONS,
    DEMUCS_DEVICE_OPTIONS,
    DEMUCS_MODEL_OPTIONS,
    DEVICE_OPTIONS,
    FILTER_CHAIN_OPTIONS,
    HF_XET_OPTIONS,
    type HfXet,
    KARAOKE_TAG_OPTIONS,
    type KaraokeTag,
    type Language,
    LANGUAGE_OPTIONS,
    LOCAL_CACHE_OPTIONS,
    type LocalOnly,
    LOG_LEVEL_OPTIONS,
    type LogLevel,
    PARSER_ENCODING_OPTIONS,
    type Repetition,
    REPETITION_OPTIONS,
    type Spacing,
    SPACING_OPTIONS,
    SPLITTER_BACKEND_OPTIONS,
    STAGE_OPTIONS,
    transcriberBackendOptions,
    transcriberModelOptions,
    VAD_FILTER_OPTIONS,
    WRITER_OPTIONS,
} from "./autoTimingOptions.js";

type Labels = Record<string, string | undefined>;

const label = (labels: Labels, key: string): string => labels[key] || key;

const sectionVisible = (showOnlyIncluded: boolean, included: boolean): boolean => !showOnlyIncluded || included;

export const AutoTimingFields: React.FC<{
    at: AutoTimingHook;
    labels: Labels;
    optionLabel: (key: string) => string;
    showOnlyIncluded?: boolean;
    disableUnavailable?: boolean;
}> = ({ at, labels, optionLabel, showOnlyIncluded = false, disableUnavailable = false }) => (
    <>
        <div className="roller-form two-col">
            <label>
                {label(labels, "lyricsLanguage")}
                <select value={at.language} onChange={(ev) => at.setLanguage(ev.target.value as Language)}>
                    {optionNodes(LANGUAGE_OPTIONS, optionLabel)}
                </select>
            </label>
            <label>
                {label(labels, "processingPreset")}
                <select value={at.stages} onChange={(ev) => at.setStages(ev.target.value)}>
                    {optionNodes(STAGE_OPTIONS, optionLabel)}
                </select>
            </label>
            <label>
                {label(labels, "outputFormat")}
                <select value={at.writerBackend} onChange={(ev) => at.setWriterBackend(ev.target.value)}>
                    {optionNodes(WRITER_OPTIONS, optionLabel)}
                </select>
            </label>
            <label>
                {label(labels, "repetitionHandling")}
                <select
                    value={at.alignerRepetition}
                    onChange={(ev) => at.setAlignerRepetition(ev.target.value as Repetition)}
                    disabled={disableUnavailable && !at.includesAligner}
                >
                    {optionNodes(REPETITION_OPTIONS, optionLabel)}
                </select>
            </label>
            <label>
                {label(labels, "spacing")}
                <select
                    value={at.writerSpacing}
                    onChange={(ev) => at.setWriterSpacing(ev.target.value as Spacing)}
                    disabled={disableUnavailable && !at.includesWriter}
                >
                    {optionNodes(SPACING_OPTIONS, optionLabel)}
                </select>
            </label>
        </div>

        <details>
            <summary>{label(labels, "advanced")}</summary>
            <div className="roller-section-title">{label(labels, "pipelineRuntime")}</div>
            <div className="roller-form two-col">
                <label>
                    {label(labels, "cleanupPolicy")}
                    <select value={at.cleanup} onChange={(ev) => at.setCleanup(ev.target.value as Cleanup)}>
                        {optionNodes(CLEANUP_OPTIONS, optionLabel)}
                    </select>
                </label>
                <label>
                    {label(labels, "logLevel")}
                    <select value={at.logLevel} onChange={(ev) => at.setLogLevel(ev.target.value as LogLevel)}>
                        {optionNodes(LOG_LEVEL_OPTIONS, optionLabel)}
                    </select>
                </label>
            </div>

            {sectionVisible(showOnlyIncluded, at.includesTranscriber) && (
                <>
                    <div className="roller-section-title">{label(labels, "modelDownload")}</div>
                    <div className="roller-form two-col">
                        <label>
                            {label(labels, "hfXet")}
                            <select value={at.hfXet} onChange={(ev) => at.setHfXet(ev.target.value as HfXet)}>
                                {optionNodes(HF_XET_OPTIONS, optionLabel)}
                            </select>
                        </label>
                        <label>
                            {label(labels, "proxyUrl")}
                            <input
                                placeholder="http://127.0.0.1:7890"
                                value={at.hfProxy}
                                onChange={(ev) => at.setHfProxy(ev.target.value)}
                            />
                        </label>
                        <label>
                            {label(labels, "metadataTimeout")}
                            <input
                                inputMode="numeric"
                                placeholder={optionLabel("Library built-in")}
                                value={at.hfEtagTimeout}
                                onChange={(ev) => at.setHfEtagTimeout(ev.target.value)}
                            />
                        </label>
                        <label>
                            {label(labels, "fileDownloadTimeout")}
                            <input
                                inputMode="numeric"
                                placeholder={optionLabel("Library built-in")}
                                value={at.hfDownloadTimeout}
                                onChange={(ev) => at.setHfDownloadTimeout(ev.target.value)}
                            />
                        </label>
                        <label>
                            {label(labels, "maxDownloadWorkers")}
                            <input
                                inputMode="numeric"
                                placeholder={optionLabel("Library built-in")}
                                value={at.hfMaxWorkers}
                                onChange={(ev) => at.setHfMaxWorkers(ev.target.value)}
                            />
                        </label>
                        <label>
                            {label(labels, "localCacheMode")}
                            <select
                                value={at.localOnly}
                                onChange={(ev) => at.setLocalOnly(ev.target.value as LocalOnly)}
                            >
                                {optionNodes(LOCAL_CACHE_OPTIONS, optionLabel)}
                            </select>
                        </label>
                    </div>
                </>
            )}

            {sectionVisible(showOnlyIncluded, at.includesSplitter) && (
                <>
                    <div className="roller-section-title">{label(labels, "splitter")}</div>
                    <div className="roller-form two-col">
                        <label>
                            {label(labels, "backend")}
                            <select
                                value={at.splitterBackend}
                                onChange={(ev) => at.setSplitterBackend(ev.target.value)}
                            >
                                {optionNodes(SPLITTER_BACKEND_OPTIONS, optionLabel)}
                            </select>
                        </label>
                        <label>
                            {label(labels, "demucsModel")}
                            <select value={at.splitterModel} onChange={(ev) => at.setSplitterModel(ev.target.value)}>
                                {optionNodes(DEMUCS_MODEL_OPTIONS, optionLabel)}
                            </select>
                        </label>
                        <label>
                            {label(labels, "device")}
                            <select value={at.splitterDevice} onChange={(ev) => at.setSplitterDevice(ev.target.value)}>
                                {optionNodes(DEMUCS_DEVICE_OPTIONS, optionLabel)}
                            </select>
                        </label>
                        <label>
                            {label(labels, "jobs")}
                            <input
                                inputMode="numeric"
                                placeholder={optionLabel("Auto-detect")}
                                value={at.splitterJobs}
                                onChange={(ev) => at.setSplitterJobs(ev.target.value)}
                            />
                        </label>
                        <label>
                            {label(labels, "overlap")}
                            <input
                                inputMode="decimal"
                                placeholder={optionLabel("Default")}
                                value={at.splitterOverlap}
                                onChange={(ev) => at.setSplitterOverlap(ev.target.value)}
                            />
                        </label>
                        <label>
                            {label(labels, "segment")}
                            <input
                                inputMode="decimal"
                                placeholder={optionLabel("Default")}
                                value={at.splitterSegment}
                                onChange={(ev) => at.setSplitterSegment(ev.target.value)}
                            />
                        </label>
                    </div>
                </>
            )}

            {sectionVisible(showOnlyIncluded, at.includesFilter) && (
                <>
                    <div className="roller-section-title">{label(labels, "filter")}</div>
                    <div className="roller-form">
                        <label>
                            {label(labels, "filterChain")}
                            <select value={at.filterChain} onChange={(ev) => at.setFilterChain(ev.target.value)}>
                                {optionNodes(FILTER_CHAIN_OPTIONS, optionLabel)}
                            </select>
                        </label>
                    </div>
                </>
            )}

            {sectionVisible(showOnlyIncluded, at.includesTranscriber) && (
                <>
                    <div className="roller-section-title">{label(labels, "transcriber")}</div>
                    <div className="roller-form two-col">
                        <label>
                            {label(labels, "backend")}
                            <select
                                value={at.transcriberBackend}
                                onChange={(ev) => at.setTranscriberBackend(ev.target.value)}
                            >
                                {optionNodes(transcriberBackendOptions(at.language), optionLabel)}
                            </select>
                        </label>
                        <label>
                            {label(labels, "device")}
                            <select
                                value={at.transcriberDevice}
                                onChange={(ev) => at.setTranscriberDevice(ev.target.value)}
                            >
                                {optionNodes(DEVICE_OPTIONS, optionLabel)}
                            </select>
                        </label>
                        <label>
                            {label(labels, "modelName")}
                            <select
                                value={at.transcriberModel}
                                onChange={(ev) => at.setTranscriberModel(ev.target.value)}
                            >
                                {optionNodes(transcriberModelOptions(at.language, at.transcriberBackend), optionLabel)}
                            </select>
                        </label>
                        <label>
                            {label(labels, "computeType")}
                            <select
                                value={at.transcriberComputeType}
                                onChange={(ev) => at.setTranscriberComputeType(ev.target.value)}
                                disabled={!at.transcriberIsFasterWhisper}
                            >
                                {optionNodes(COMPUTE_TYPE_OPTIONS, optionLabel)}
                            </select>
                        </label>
                        <label>
                            {label(labels, "batchSize")}
                            <input
                                inputMode="numeric"
                                placeholder="8"
                                value={at.transcriberBatchSize}
                                onChange={(ev) => at.setTranscriberBatchSize(ev.target.value)}
                                disabled={!at.transcriberIsFasterWhisper}
                            />
                        </label>
                        <label>
                            {label(labels, "vadFilter")}
                            <select value={at.vadFilter} onChange={(ev) => at.setVadFilter(ev.target.value)}>
                                {optionNodes(VAD_FILTER_OPTIONS, optionLabel)}
                            </select>
                        </label>
                    </div>
                </>
            )}

            {sectionVisible(showOnlyIncluded, at.includesParser) && (
                <>
                    <div className="roller-section-title">{label(labels, "parser")}</div>
                    <div className="roller-form">
                        <label>
                            {label(labels, "lyricsEncoding")}
                            <select value={at.parserEncoding} onChange={(ev) => at.setParserEncoding(ev.target.value)}>
                                {optionNodes(PARSER_ENCODING_OPTIONS, optionLabel)}
                            </select>
                        </label>
                    </div>
                </>
            )}

            {sectionVisible(showOnlyIncluded, at.includesAligner) && (
                <>
                    <div className="roller-section-title">{label(labels, "aligner")}</div>
                    <div className="roller-form two-col">
                        <label>
                            {label(labels, "backend")}
                            <select value={at.alignerBackend} onChange={(ev) => at.setAlignerBackend(ev.target.value)}>
                                {optionNodes(ALIGNER_BACKEND_OPTIONS, optionLabel)}
                            </select>
                        </label>
                        <label>
                            {label(labels, "minGap")}
                            <input
                                inputMode="decimal"
                                placeholder="0.5"
                                value={at.alignerMinGap}
                                onChange={(ev) => at.setAlignerMinGap(ev.target.value)}
                            />
                        </label>
                    </div>
                </>
            )}

            {sectionVisible(showOnlyIncluded, at.includesWriter) && (
                <>
                    <div className="roller-section-title">{label(labels, "writer")}</div>
                    <div className="roller-form two-col">
                        <label>
                            {label(labels, "byTag")}
                            <input
                                placeholder="RollingPebble"
                                value={at.writerByTag}
                                onChange={(ev) => at.setWriterByTag(ev.target.value)}
                            />
                        </label>
                        <label>
                            {label(labels, "assKaraokeTag")}
                            <select
                                value={at.writerKaraokeTag}
                                onChange={(ev) => at.setWriterKaraokeTag(ev.target.value as KaraokeTag)}
                                disabled={!at.writerIsAss}
                            >
                                {optionNodes(KARAOKE_TAG_OPTIONS, optionLabel)}
                            </select>
                        </label>
                    </div>
                </>
            )}
        </details>
    </>
);
