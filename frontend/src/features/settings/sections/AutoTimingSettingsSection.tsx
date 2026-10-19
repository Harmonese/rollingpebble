import { useState } from "react";
import type { AutoTimingHook } from "../../../domain/auto-timing/useAutoTimingState.js";
import type { Language } from "../../../languages/index.js";
import { cachedPreparation } from "../../../shared/api/runtimePreparation.js";
import { SectionTitle } from "../../../ui/index.js";
import { AutoTimingFields } from "../../roller/AutoTimingFields.js";
import { EngineModels } from "./EngineModels.js";
import { RuntimeDiagnostics, RuntimePreparation } from "./RuntimePreparation.js";

export function AutoTimingSettingsSection({ title, lang, at, loaded }: {
    title: string;
    lang: Language;
    at: AutoTimingHook;
    loaded: boolean;
}) {
    const [ready, setReady] = useState(cachedPreparation()?.status === "ready");
    return (
        <section className="settings-section">
            <h3>{title}</h3>
            {loaded && (
                <RuntimePreparation
                    lang={lang}
                    vocals={at.options.audio_mode === "vocals"}
                    onReady={setReady}
                />
            )}
            <div className="settings-subsection">
                <SectionTitle>{lang.timingV2.models}</SectionTitle>
                <EngineModels ready={ready} />
            </div>
            <div className="settings-subsection">
                <SectionTitle>{lang.storageV3.defaults}</SectionTitle>
                <AutoTimingFields at={at} settingsMode />
            </div>
            <RuntimeDiagnostics lang={lang} />
        </section>
    );
}
