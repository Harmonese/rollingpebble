import type { Language } from "../../../languages/index.js";
import { ActionRow } from "../../../ui/index.js";

export const ResetSettingsSection: React.FC<{
    title: string;
    t: Language["settings"];
    busy: boolean;
    resetDefaults: () => void;
}> = ({ title, t, busy, resetDefaults }) => (
    <section className="settings-section">
        <h3>{title}</h3>
        <ActionRow title={t.general.resetDefaults} className="settings-danger-row">
            <button className="danger-action" type="button" disabled={busy} onClick={resetDefaults}>
                {t.common.reset}
            </button>
        </ActionRow>
    </section>
);
