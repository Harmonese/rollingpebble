import { useEffect, useState } from "react";
import { timingBinding } from "../../../shared/api/timingV2.js";

type Status = "checking" | "matched" | "mismatched" | "failed";
export function useTimingBinding(
    runId: string | undefined,
    projectId: string | undefined,
    runProjectId: string | undefined,
    workspaceId: string,
    audioPending: boolean,
    audioRef: string | null | undefined,
) {
    const key = JSON.stringify([runId, projectId, runProjectId, workspaceId, audioPending, audioRef]);
    const eligible = Boolean(runId && projectId === runProjectId && !audioPending);
    const [result, setResult] = useState<{ key: string; status: Status }>({ key: "", status: "checking" });
    useEffect(() => {
        if (!eligible || !runId) return;
        let stale = false;
        setResult({ key, status: "checking" });
        void timingBinding(runId).then(value => {
            if (!stale) setResult({ key, status: value.matches ? "matched" : "mismatched" });
        }).catch(() => {
            if (!stale) setResult({ key, status: "failed" });
        });
        return () => {
            stale = true;
        };
    }, [key, eligible, runId]);
    return !eligible ? "mismatched" : result.key === key ? result.status : "checking";
}
