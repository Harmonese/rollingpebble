import { StorageLocationsSection } from "./StorageLocationsSection.js";
import { StorageModelsSection } from "./StorageModelsSection.js";
import { StorageOtherSection } from "./StorageOtherSection.js";
import { StorageProjectsSection } from "./StorageProjectsSection.js";
import { StorageRuntimesSection } from "./StorageRuntimesSection.js";
import type { StorageSettingsProps } from "./storageTypes.js";

export const StorageSettingsSection: React.FC<StorageSettingsProps> = (props) => (
    <section className="settings-section storage-cleanup-section">
        <h3>{props.title}</h3>
        <StorageLocationsSection {...props} />
        <StorageProjectsSection {...props} />
        <StorageModelsSection {...props} />
        <StorageRuntimesSection {...props} />
        <StorageOtherSection {...props} />
    </section>
);
