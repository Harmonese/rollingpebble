import type { Language } from "../../../languages/index.js";
import { ActionRow, Button } from "../../../ui/index.js";

export const ResetSettingsSection: React.FC<{
    title: string;
    t: Language["settings"];
    busy: boolean;
    resetDefaults: () => void;
}> = ({ title, t, busy, resetDefaults }) => (
    <section className="settings-section">
        <h3>{title}</h3>
        <ActionRow title={t.general.resetDefaults} className="settings-danger-row">
            <Button tone="danger" disabled={busy} onClick={resetDefaults}>
                {t.common.reset}
            </Button>
        </ActionRow>
    </section>
);
