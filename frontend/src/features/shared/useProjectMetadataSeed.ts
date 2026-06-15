import { useEffect, useRef, useState } from "react";
import { useSettingsUpdated } from "../../hooks/useSettingsUpdated.js";
import type { MetaModel, ProjectModel } from "../../shared/api/types.js";
import { settings } from "../../shared/api/settings.js";

const emptyMeta: MetaModel = { track: "", artist: "", album: "", duration: 0 };

function normalizedMeta(source: MetaModel | null | undefined): MetaModel {
    return {
        track: source?.track || "",
        artist: source?.artist || "",
        album: source?.album || "",
        duration: Number(source?.duration) || 0,
    };
}

export function useProjectMetadataSeed(args: {
    project: ProjectModel | null;
    fallbackMeta?: MetaModel | null;
    updateQuery?: (query: string) => void;
}) {
    const { project, fallbackMeta, updateQuery } = args;
    const [meta, setMeta] = useState<MetaModel>(normalizedMeta(project?.metadata || fallbackMeta || emptyMeta));
    const [autoFillFromProject, setAutoFillFromProject] = useState(true);
    const lastAutoFilledProjectId = useRef<string | null>(null);

    const refreshSettings = async () => {
        try {
            const runtimeSettings = await settings();
            setAutoFillFromProject(runtimeSettings.auto_fill_lyrics_library_from_project_metadata);
        } catch {
            setAutoFillFromProject(true);
        }
    };

    useSettingsUpdated(refreshSettings, true);

    useEffect(() => {
        if (!autoFillFromProject) return;
        const source = project?.metadata || fallbackMeta || emptyMeta;
        const next = normalizedMeta(source);
        setMeta(next);
        const currentProjectId = project?.project_id || null;
        if (currentProjectId !== lastAutoFilledProjectId.current) {
            lastAutoFilledProjectId.current = currentProjectId;
            updateQuery?.([next.artist, next.track].filter(Boolean).join(" "));
        }
    }, [
        autoFillFromProject,
        project?.project_id,
        project?.metadata.track,
        project?.metadata.artist,
        project?.metadata.album,
        project?.metadata.duration,
        fallbackMeta?.track,
        fallbackMeta?.artist,
        fallbackMeta?.album,
        fallbackMeta?.duration,
        updateQuery,
    ]);

    const updateMeta = (key: keyof MetaModel, value: string) => {
        setMeta((old) => ({ ...old, [key]: key === "duration" ? Number(value) || 0 : value }));
    };

    return { meta, setMeta, updateMeta, autoFillFromProject };
}
