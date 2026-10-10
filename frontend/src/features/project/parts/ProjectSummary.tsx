import type { ProjectModel } from "../../../shared/api/types.js";
import { KeyValueList } from "../../../ui/index.js";

function formatLyricsSource(
    source: string | null | undefined,
    labels: { manual: string; sourceLrclib: string; sourceLocalFile: string; sourceAutoTiming: string },
): string {
    if (!source || source === "manual") return labels.manual;
    if (source === "lrclib") return labels.sourceLrclib;
    if (source === "local file") return labels.sourceLocalFile;
    if (source === "automatic timing") return labels.sourceAutoTiming;
    return source || "";
}

export const ProjectSummary: React.FC<{
    project: ProjectModel | null;
    draftAudioName?: string;
    draftMetadata?: ProjectModel["metadata"];
    draftSource?: string;
    saved: boolean;
    labels: {
        id: string;
        audio: string;
        title: string;
        artist: string;
        duration: string;
        lyricsSource: string;
        projectStatus: string;
        saved: string;
        unsaved: string;
        manual: string;
        sourceLrclib: string;
        sourceLocalFile: string;
        sourceAutoTiming: string;
    };
}> = ({ project, draftAudioName, draftMetadata, draftSource, saved, labels }) => {
    if (!project && !draftAudioName && !draftMetadata) return null;
    const metadata = draftMetadata || project?.metadata || { track: "", artist: "", album: "", duration: 0 };
    const source = draftSource || project?.source || "manual";
    return (
        <KeyValueList>
            <b>{labels.id}</b>
            <span>{project?.project_id || "-"}</span>
            <b>{labels.audio}</b>
            <span>{draftAudioName || project?.audio_name || "-"}</span>
            <b>{labels.title}</b>
            <span>{metadata.track || "-"}</span>
            <b>{labels.artist}</b>
            <span>{metadata.artist || "-"}</span>
            <b>{labels.duration}</b>
            <span>{metadata.duration ? `${metadata.duration}s` : "-"}</span>
            <b>{labels.lyricsSource}</b>
            <span>{formatLyricsSource(source, labels)}</span>
            <b>{labels.projectStatus}</b>
            <span>{saved ? labels.saved : labels.unsaved}</span>
        </KeyValueList>
    );
};
