import { backendMessageText } from "../../../shared/api/request.js";
import type { JobModel, RollPreview } from "../../../shared/api/types.js";
import type { Language } from "../../../languages/index.js";
import { ButtonGroup, CommandBlock, MutedText, WarningText } from "../../../ui/index.js";
import { formatCommandPreview } from "./rollerProgress.js";

export const CommandPreview: React.FC<{
    preview: RollPreview | null;
    job: JobModel | null;
    previewBusy: boolean;
    lang: Language;
    onCopy: () => void;
}> = ({ preview, job, previewBusy, lang, onCopy }) => {
    const u = lang.ui;
    const commandPreviewText = formatCommandPreview(preview?.command_text, u.commandPreviewPlaceholder);
    return (
        <details>
            <summary>{u.commandPreview}</summary>
            <ButtonGroup compact>
                <button type="button" disabled={!preview && !job} onClick={onCopy}>
                    {u.copyCommand}
                </button>
            </ButtonGroup>
            {previewBusy && <MutedText>{u.updatingPreview}</MutedText>}
            {(preview?.warning_messages?.length
                ? preview.warning_messages.map((warning) => backendMessageText(warning, lang.backendMessages))
                : preview?.warnings || []).map((warning) => (
                    <WarningText key={warning}>{warning}</WarningText>
                ))}
            <CommandBlock aria-label={u.commandPreview}><code>{commandPreviewText}</code></CommandBlock>
        </details>
    );
};
