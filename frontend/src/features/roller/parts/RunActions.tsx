import { ButtonGroup, SectionTitle } from "../../../ui/index.js";

export const RunActions: React.FC<{
    mode: "single" | "batch";
    labels: {
        run: string;
        start: string;
        startBatch: string;
        cancel: string;
        retry: string;
    };
    singleStartDisabled: boolean;
    batchStartDisabled: boolean;
    cancelDisabled: boolean;
    retrySingleDisabled: boolean;
    retryBatchDisabled: boolean;
    onStart: () => void;
    onStartBatch: () => void;
    onCancel: () => void;
    onRetry: () => void;
}> = ({
    mode,
    labels,
    singleStartDisabled,
    batchStartDisabled,
    cancelDisabled,
    retrySingleDisabled,
    retryBatchDisabled,
    onStart,
    onStartBatch,
    onCancel,
    onRetry,
}) => (
    <>
        <SectionTitle>{labels.run}</SectionTitle>
        <ButtonGroup className="studio-run-actions">
            {mode === "single"
                ? (
                    <>
                        <button
                            type="button"
                            className="studio-action-start"
                            disabled={singleStartDisabled}
                            onClick={onStart}
                        >
                            {labels.start}
                        </button>
                        <button
                            type="button"
                            className="studio-action-cancel"
                            disabled={cancelDisabled}
                            onClick={onCancel}
                        >
                            {labels.cancel}
                        </button>
                        <button
                            type="button"
                            className="studio-action-retry"
                            disabled={retrySingleDisabled}
                            onClick={onRetry}
                        >
                            {labels.retry}
                        </button>
                    </>
                )
                : (
                    <>
                        <button
                            type="button"
                            className="studio-action-start"
                            disabled={batchStartDisabled}
                            onClick={onStartBatch}
                        >
                            {labels.startBatch}
                        </button>
                        <button
                            type="button"
                            className="studio-action-cancel"
                            disabled={cancelDisabled}
                            onClick={onCancel}
                        >
                            {labels.cancel}
                        </button>
                        <button
                            type="button"
                            className="studio-action-retry"
                            disabled={retryBatchDisabled}
                            onClick={onStartBatch}
                        >
                            {labels.retry}
                        </button>
                    </>
                )}
        </ButtonGroup>
    </>
);
