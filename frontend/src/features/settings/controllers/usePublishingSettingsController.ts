import type { SettingsControllerContext } from "./settingsControllerUtils.js";
import { saveSettingsPatch } from "./settingsControllerUtils.js";

export function usePublishingSettingsController(options: SettingsControllerContext & {
    setUploadDerivePlain: (value: boolean) => void;
}) {
    const { lang, refresh, setBusy, setMessage, setUploadDerivePlain } = options;

    const saveUploadDerivePlain = (checked: boolean) => {
        setUploadDerivePlain(checked);
        void saveSettingsPatch({ lang, refresh, setBusy, setMessage }, { upload_derive_plain_from_synced: checked });
    };

    return { saveUploadDerivePlain };
}
