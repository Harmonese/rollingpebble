import { useEffect, useRef, useState } from "react";
import { useSettingsUpdated } from "../../hooks/useSettingsUpdated.js";
import { settings } from "../../shared/api/settings.js";
import type { MetaModel, ProjectModel } from "../../shared/api/types.js";

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
    const [meta, setMeta] = useState<MetaModel>(normalizedMeta(fallbackMeta || project?.metadata || emptyMeta));
    const [autoFillFromProject, setAutoFillFromProject] = useState(true);
    const lastAutoFilledSeed = useRef<string | null>(null);

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
        const source = fallbackMeta || project?.metadata || emptyMeta;
        const next = normalizedMeta(source);
        setMeta(next);
        const seed = JSON.stringify([project?.project_id || null, next]);
        if (seed !== lastAutoFilledSeed.current) {
            lastAutoFilledSeed.current = seed;
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
