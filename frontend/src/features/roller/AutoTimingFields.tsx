import React from "react";
import type { AutoTimingHook } from "../../domain/auto-timing/useAutoTimingState.js";
import { FormGrid, SectionTitle } from "../../ui/index.js";
import { optionNodes } from "../../shared/optionNodes.js";
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
    type Option,
    PARSER_ENCODING_OPTIONS,
    REPETITION_OPTIONS,
    SPACING_OPTIONS,
    SPLITTER_BACKEND_OPTIONS,
    STAGE_OPTIONS,
    transcriberBackendOptions,
    transcriberModelOptions,
    VAD_FILTER_OPTIONS,
    WRITER_OPTIONS,
} from "../../domain/auto-timing/autoTimingOptions.js";

type Labels = Record<string, string | undefined>;

type SelectField = {
    kind: "select";
    key: string;
    value: string;
    options: Option[];
    onChange: (value: string) => void;
    disabled?: boolean;
};

type InputField = {
    kind: "input";
    key: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
    disabled?: boolean;
};

type FieldSpec = SelectField | InputField;

type SectionSpec = {
    key: string;
    included?: boolean;
    columns?: 1 | 2;
    fields: FieldSpec[];
};

const label = (labels: Labels, key: string): string => labels[key] || key;
const sectionVisible = (showOnlyIncluded: boolean, included = true): boolean => !showOnlyIncluded || included;
const asStringSetter = <T extends string>(setter: (value: T) => void) => (value: string) => setter(value as T);

function renderField(field: FieldSpec, labels: Labels, optionLabel: (key: string) => string) {
    return (
        <label key={field.key}>
            {label(labels, field.key)}
            {field.kind === "select"
                ? (
                    <select
                        value={field.value}
                        onChange={(ev) => field.onChange(ev.target.value)}
                        disabled={field.disabled}
                    >
                        {optionNodes(field.options, optionLabel)}
                    </select>
                )
                : (
                    <input
                        inputMode={field.inputMode}
                        placeholder={field.placeholder}
                        value={field.value}
                        onChange={(ev) => field.onChange(ev.target.value)}
                        disabled={field.disabled}
                    />
                )}
        </label>
    );
}

function renderSection(
    section: SectionSpec,
    labels: Labels,
    optionLabel: (key: string) => string,
    showOnlyIncluded: boolean,
) {
    if (!sectionVisible(showOnlyIncluded, section.included)) return null;
    return (
        <React.Fragment key={section.key}>
            <SectionTitle>{label(labels, section.key)}</SectionTitle>
            <FormGrid columns={section.columns || 1}>
                {section.fields.map((field) => renderField(field, labels, optionLabel))}
            </FormGrid>
        </React.Fragment>
    );
}

function baseFields(at: AutoTimingHook, disableUnavailable: boolean): FieldSpec[] {
    return [
        { kind: "select", key: "lyricsLanguage", value: at.language, options: LANGUAGE_OPTIONS, onChange: asStringSetter(at.setLanguage) },
        { kind: "select", key: "processingPreset", value: at.stages, options: STAGE_OPTIONS, onChange: at.setStages },
        { kind: "select", key: "outputFormat", value: at.writerBackend, options: WRITER_OPTIONS, onChange: at.setWriterBackend },
        {
            kind: "select",
            key: "repetitionHandling",
            value: at.alignerRepetition,
            options: REPETITION_OPTIONS,
            onChange: asStringSetter(at.setAlignerRepetition),
            disabled: disableUnavailable && !at.includesAligner,
        },
        {
            kind: "select",
            key: "spacing",
            value: at.writerSpacing,
            options: SPACING_OPTIONS,
            onChange: asStringSetter(at.setWriterSpacing),
            disabled: disableUnavailable && !at.includesWriter,
        },
    ];
}

function advancedSections(at: AutoTimingHook, optionLabel: (key: string) => string): SectionSpec[] {
    return [
        {
            key: "pipelineRuntime",
            columns: 2,
            fields: [
                { kind: "select", key: "cleanupPolicy", value: at.cleanup, options: CLEANUP_OPTIONS, onChange: asStringSetter(at.setCleanup) },
                { kind: "select", key: "logLevel", value: at.logLevel, options: LOG_LEVEL_OPTIONS, onChange: asStringSetter(at.setLogLevel) },
            ],
        },
        {
            key: "modelDownload",
            included: at.includesTranscriber,
            columns: 2,
            fields: [
                { kind: "select", key: "hfXet", value: at.hfXet, options: HF_XET_OPTIONS, onChange: asStringSetter(at.setHfXet) },
                { kind: "input", key: "proxyUrl", value: at.hfProxy, placeholder: "http://127.0.0.1:7890", onChange: at.setHfProxy },
                {
                    kind: "input",
                    key: "metadataTimeout",
                    value: at.hfEtagTimeout,
                    placeholder: optionLabel("Library built-in"),
                    inputMode: "numeric",
                    onChange: at.setHfEtagTimeout,
                },
                {
                    kind: "input",
                    key: "fileDownloadTimeout",
                    value: at.hfDownloadTimeout,
                    placeholder: optionLabel("Library built-in"),
                    inputMode: "numeric",
                    onChange: at.setHfDownloadTimeout,
                },
                {
                    kind: "input",
                    key: "maxDownloadWorkers",
                    value: at.hfMaxWorkers,
                    placeholder: optionLabel("Library built-in"),
                    inputMode: "numeric",
                    onChange: at.setHfMaxWorkers,
                },
                { kind: "select", key: "localCacheMode", value: at.localOnly, options: LOCAL_CACHE_OPTIONS, onChange: asStringSetter(at.setLocalOnly) },
            ],
        },
        {
            key: "splitter",
            included: at.includesSplitter,
            columns: 2,
            fields: [
                { kind: "select", key: "backend", value: at.splitterBackend, options: SPLITTER_BACKEND_OPTIONS, onChange: at.setSplitterBackend },
                { kind: "select", key: "demucsModel", value: at.splitterModel, options: DEMUCS_MODEL_OPTIONS, onChange: at.setSplitterModel },
                { kind: "select", key: "device", value: at.splitterDevice, options: DEMUCS_DEVICE_OPTIONS, onChange: at.setSplitterDevice },
                { kind: "input", key: "jobs", value: at.splitterJobs, placeholder: optionLabel("Auto-detect"), inputMode: "numeric", onChange: at.setSplitterJobs },
                { kind: "input", key: "overlap", value: at.splitterOverlap, placeholder: optionLabel("Default"), inputMode: "decimal", onChange: at.setSplitterOverlap },
                { kind: "input", key: "segment", value: at.splitterSegment, placeholder: optionLabel("Default"), inputMode: "decimal", onChange: at.setSplitterSegment },
            ],
        },
        {
            key: "filter",
            included: at.includesFilter,
            fields: [
                { kind: "select", key: "filterChain", value: at.filterChain, options: FILTER_CHAIN_OPTIONS, onChange: at.setFilterChain },
            ],
        },
        {
            key: "transcriber",
            included: at.includesTranscriber,
            columns: 2,
            fields: [
                { kind: "select", key: "backend", value: at.transcriberBackend, options: transcriberBackendOptions(at.language), onChange: at.setTranscriberBackend },
                { kind: "select", key: "device", value: at.transcriberDevice, options: DEVICE_OPTIONS, onChange: at.setTranscriberDevice },
                { kind: "select", key: "modelName", value: at.transcriberModel, options: transcriberModelOptions(at.language, at.transcriberBackend), onChange: at.setTranscriberModel },
                {
                    kind: "select",
                    key: "computeType",
                    value: at.transcriberComputeType,
                    options: COMPUTE_TYPE_OPTIONS,
                    onChange: at.setTranscriberComputeType,
                    disabled: !at.transcriberIsFasterWhisper,
                },
                {
                    kind: "input",
                    key: "batchSize",
                    value: at.transcriberBatchSize,
                    placeholder: "8",
                    inputMode: "numeric",
                    onChange: at.setTranscriberBatchSize,
                    disabled: !at.transcriberIsFasterWhisper,
                },
                { kind: "select", key: "vadFilter", value: at.vadFilter, options: VAD_FILTER_OPTIONS, onChange: at.setVadFilter },
            ],
        },
        {
            key: "parser",
            included: at.includesParser,
            fields: [
                { kind: "select", key: "lyricsEncoding", value: at.parserEncoding, options: PARSER_ENCODING_OPTIONS, onChange: at.setParserEncoding },
            ],
        },
        {
            key: "aligner",
            included: at.includesAligner,
            columns: 2,
            fields: [
                { kind: "select", key: "backend", value: at.alignerBackend, options: ALIGNER_BACKEND_OPTIONS, onChange: at.setAlignerBackend },
                { kind: "input", key: "minGap", value: at.alignerMinGap, placeholder: "0.5", inputMode: "decimal", onChange: at.setAlignerMinGap },
            ],
        },
        {
            key: "writer",
            included: at.includesWriter,
            columns: 2,
            fields: [
                { kind: "input", key: "byTag", value: at.writerByTag, placeholder: "RollingPebble", onChange: at.setWriterByTag },
                {
                    kind: "select",
                    key: "assKaraokeTag",
                    value: at.writerKaraokeTag,
                    options: KARAOKE_TAG_OPTIONS,
                    onChange: asStringSetter(at.setWriterKaraokeTag),
                    disabled: !at.writerIsAss,
                },
            ],
        },
    ];
}

export const AutoTimingFields: React.FC<{
    at: AutoTimingHook;
    labels: Labels;
    optionLabel: (key: string) => string;
    showOnlyIncluded?: boolean;
    disableUnavailable?: boolean;
}> = ({ at, labels, optionLabel, showOnlyIncluded = false, disableUnavailable = false }) => (
    <>
        <FormGrid columns={2}>
            {baseFields(at, disableUnavailable).map((field) => renderField(field, labels, optionLabel))}
        </FormGrid>

        <details>
            <summary>{label(labels, "advanced")}</summary>
            {advancedSections(at, optionLabel).map((section) =>
                renderSection(section, labels, optionLabel, showOnlyIncluded)
            )}
        </details>
    </>
);
