import { useEffect, useRef, useState } from "react";
import type { Language } from "../../../languages/index.js";
import { autoRollerRuntime } from "../../../shared/api/autoTiming.js";
import { getJob } from "../../../shared/api/jobs.js";
import { BackendApiError, backendMessageText } from "../../../shared/api/request.js";
import { cachedPreparation, ensureRuntime, type Preparation } from "../../../shared/api/runtimePreparation.js";
import { ActionRow, Button, ButtonGroup, LogBlock } from "../../../ui/index.js";
import { modelMaintenanceJob } from "./EngineModels.js";

export function RuntimePreparation(
    { lang, vocals, onReady }: { lang: Language; vocals: boolean; onReady: (ready: boolean) => void },
) {
    const t = lang.timingV2;
    const [state, setState] = useState<Preparation | null>(cachedPreparation);
    const [retry, setRetry] = useState(0);
    const usedRetry = useRef(0);
    const repairNeeded = useRef(false);
    const [failed, setFailed] = useState(false);
    const [failureText, setFailureText] = useState(t.prepareFailed);
    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        setFailed(false);
        const poll = async (repair = false) => {
            try {
                const next = await ensureRuntime(vocals, repair);
                if (stopped) return;
                setState(next);
                onReady(next.status === "ready");
                setFailed(next.status === "failed");
                repairNeeded.current = next.status === "failed";
                setFailureText(t.prepareFailed);
                if (next.status === "preparing" || next.status === "checking") {
                    timer = setTimeout(() => void poll(), 1000);
                }
            } catch (error) {
                if (!stopped) {
                    setFailed(true);
                    onReady(false);
                    repairNeeded.current = !(error instanceof BackendApiError && error.status === 409);
                    setFailureText(backendMessageText(error, lang.backendMessages));
                }
            }
        };
        const repair = retry > usedRetry.current && repairNeeded.current;
        usedRetry.current = retry;
        void poll(repair);
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, [vocals, retry]);
    return (
        <>
            {!failed && state?.status !== "ready" && (
                <p role="status">{state?.status === "preparing" ? t.preparing : t.checking}</p>
            )}
            {failed && (
                <ActionRow title={failureText}>
                    <Button onClick={() => setRetry(value => value + 1)}>
                        {repairNeeded.current ? t.repair : t.retry}
                    </Button>
                </ActionRow>
            )}
        </>
    );
}

export function RuntimeDiagnostics({ lang }: { lang: Language }) {
    const t = lang.timingV2;
    const [details, setDetails] = useState("");
    const state = cachedPreparation();
    return (
        <details
            onToggle={event => {
                if (event.currentTarget.open) {
                    const modelJobId = modelMaintenanceJob();
                    void Promise.all([
                        autoRollerRuntime(),
                        state?.job_id ? getJob(state.job_id) : null,
                        modelJobId ? getJob(modelJobId) : null,
                    ])
                        .then(([runtime, job, modelJob]) =>
                            setDetails(JSON.stringify(
                                {
                                    runtime: {
                                        ...runtime,
                                        settings: {
                                            ...runtime.settings,
                                            auto_timing_hf_proxy: runtime.settings.auto_timing_hf_proxy
                                                ? "[configured]"
                                                : "",
                                        },
                                    },
                                    job,
                                    modelJob,
                                },
                                null,
                                2,
                            ))
                        )
                        .catch(error => setDetails(String(error)));
                }
            }}
        >
            <summary>{t.diagnostics}</summary>
            <ButtonGroup>
                <Button onClick={() => void navigator.clipboard?.writeText(details)}>
                    {lang.settings.autoTiming.copyAction}
                </Button>
            </ButtonGroup>
            <LogBlock>{details}</LogBlock>
        </details>
    );
}
