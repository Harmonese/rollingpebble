import { useState } from "react";
import { api } from "../shared/api.js";
import { useSettingsUpdated } from "./useSettingsUpdated.js";

export function useEditorMetadataSetting(): boolean {
    const [includeMetadataTags, setIncludeMetadataTags] = useState(true);

    useSettingsUpdated(async () => {
        try {
            const settings = await api.settings();
            setIncludeMetadataTags(settings.editor_write_metadata_tags);
        } catch {
            setIncludeMetadataTags(true);
        }
    }, true);

    return includeMetadataTags;
}
