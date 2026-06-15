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
    labels: {
        id: string;
        audio: string;
        title: string;
        artist: string;
        duration: string;
        lyricsSource: string;
        manual: string;
        sourceLrclib: string;
        sourceLocalFile: string;
        sourceAutoTiming: string;
    };
}> = ({ project, labels }) => {
    if (!project) return null;
    return (
        <KeyValueList>
            <b>{labels.id}</b>
            <span>{project.project_id}</span>
            <b>{labels.audio}</b>
            <span>{project.audio_name || "-"}</span>
            <b>{labels.title}</b>
            <span>{project.metadata.track || "-"}</span>
            <b>{labels.artist}</b>
            <span>{project.metadata.artist || "-"}</span>
            <b>{labels.duration}</b>
            <span>{project.metadata.duration ? `${project.metadata.duration}s` : "-"}</span>
            <b>{labels.lyricsSource}</b>
            <span>{formatLyricsSource(project.source, labels)}</span>
        </KeyValueList>
    );
};
