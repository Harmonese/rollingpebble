import type { AutoTimingHook } from "../../../domain/auto-timing/useAutoTimingState.js";
import type { AutoTimingInputState } from "../../../domain/auto-timing/inputReadiness.js";
import { InputStatusGroup, SectionTitle, WarningText } from "../../../ui/index.js";
import { runtimeMessage } from "./rollerProgress.js";

export const InputStatus: React.FC<{
    at: AutoTimingHook;
    inputState: AutoTimingInputState;
    previewError: string;
    labels: {
        inputStatus: string;
        audio: string;
        lyrics: string;
        ready: string;
        missing: string;
        notNeeded: string;
        autoTimingRuntimeNotReady: string;
    };
}> = ({ at, inputState, previewError, labels }) => (
    <>
        <SectionTitle>{labels.inputStatus}</SectionTitle>
        <InputStatusGroup>
            <span className={inputState.audioReady ? "status-ok" : "status-missing"}>
                {labels.audio}: {at.includesTranscriber || at.includesSplitter || at.includesFilter
                    ? (inputState.audioReady ? labels.ready : labels.missing)
                    : labels.notNeeded}
            </span>
            <span className={inputState.lyricsReady ? "status-ok" : "status-missing"}>
                {labels.lyrics}: {at.includesParser ? (inputState.lyricsReady ? labels.ready : labels.missing) : labels.notNeeded}
            </span>
        </InputStatusGroup>
        {!inputState.ready && <WarningText>{inputState.reason}</WarningText>}
        {previewError && <WarningText>{runtimeMessage(previewError, labels)}</WarningText>}
    </>
);
