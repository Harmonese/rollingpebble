import { useState } from "react";
import { settings } from "../shared/api/settings.js";
import { useSettingsUpdated } from "./useSettingsUpdated.js";

export function useEditorMetadataSetting(): boolean {
    const [includeMetadataTags, setIncludeMetadataTags] = useState(true);

    useSettingsUpdated(async () => {
        try {
            const runtimeSettings = await settings();
            setIncludeMetadataTags(runtimeSettings.editor_write_metadata_tags);
        } catch {
            setIncludeMetadataTags(true);
        }
    }, true);

    return includeMetadataTags;
}
