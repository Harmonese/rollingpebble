import type { Language } from "../../../languages/index.js";
import { CheckRow } from "../../../ui/index.js";

export const PublishingSettingsSection: React.FC<{
    title: string;
    t: Language["settings"];
    busy: boolean;
    uploadDerivePlain: boolean;
    saveUploadDerivePlain: (value: boolean) => void;
}> = ({ title, t, busy, uploadDerivePlain, saveUploadDerivePlain }) => (
    <section className="settings-section">
        <h3>{title}</h3>
        <CheckRow
            checked={uploadDerivePlain}
            disabled={busy}
            title={t.upload.derivePlain}
            description={t.upload.derivePlainDesc}
            onChange={saveUploadDerivePlain}
        />
    </section>
);
