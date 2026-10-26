import { useEffect, useRef, useState } from "react";
import { useSettingsUpdated } from "../../hooks/useSettingsUpdated.js";
import { settings } from "../../shared/api/settings.js";
import type { MetaModel, ProjectModel } from "../../shared/api/types.js";

const emptyMeta: MetaModel = { track: "", artist: "", album: "", duration: 0 };
export function useProjectMetadataSeed(args: {
    project?: ProjectModel | null;
    fallbackMeta?: Partial<MetaModel> | null;
    panelSessionId?: string;
    querySeed?: string;
}) {
    const { project, fallbackMeta, panelSessionId = "", querySeed } = args;
    const source = fallbackMeta || project?.metadata || emptyMeta;
    const next = {
        track: source.track || "",
        artist: source.artist || "",
        album: source.album || "",
        duration: Number(source.duration) || 0,
    };
    const seed = JSON.stringify(next);
    const [meta, setMeta] = useState<MetaModel>(emptyMeta);
    const [query, setQuery] = useState("");
    const [autoFillFromProject, setAutoFillFromProject] = useState(false);
    const manual = useRef(new Set<keyof MetaModel | "query">());
    const session = useRef(panelSessionId);
    const mounted = useRef(true);
    const settingsRevision = useRef(0);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    useSettingsUpdated(async () => {
        const revision = ++settingsRevision.current;
        try {
            const value = await settings();
            if (mounted.current && settingsRevision.current === revision) {
                setAutoFillFromProject(value.auto_fill_lyrics_library_from_project_metadata);
            }
        } catch {
            if (mounted.current && settingsRevision.current === revision) setAutoFillFromProject(true);
        }
    }, true);
    useEffect(() => {
        const changed = session.current !== panelSessionId;
        if (changed) {
            session.current = panelSessionId;
            manual.current.clear();
        }
        setMeta(old =>
            Object.fromEntries(
                Object.keys(emptyMeta).map(key => {
                    const field = key as keyof MetaModel;
                    return [
                        field,
                        manual.current.has(field) ? old[field] : autoFillFromProject ? next[field] : emptyMeta[field],
                    ];
                }),
            ) as MetaModel
        );
        if (!manual.current.has("query")) {
            setQuery(autoFillFromProject ? querySeed ?? [next.artist, next.track].filter(Boolean).join(" ") : "");
        }
    }, [panelSessionId, seed, autoFillFromProject, querySeed]);
    const updateMeta = (key: keyof MetaModel, value: string) => {
        manual.current.add(key);
        setMeta(old => ({ ...old, [key]: key === "duration" ? Number(value) || 0 : value }));
    };
    const updateQuery = (value: string) => {
        manual.current.add("query");
        setQuery(value);
    };
    return { meta, query, updateQuery, updateMeta, autoFillFromProject };
}
