import { BackendApiError, request } from "./request.js";

export type Preparation = {
    status: "checking" | "preparing" | "ready" | "failed";
    capabilities: ("original" | "vocals" | "multilingual")[];
    job_id: string | null;
    error: string | null;
};

let latestPreparation: Preparation | null = null;
export const cachedPreparation = () => latestPreparation;

export const ensureRuntime = async (vocals: boolean, repair = false, multilingual = false): Promise<Preparation> => {
    const result = await request<Preparation>("/api/runtime/auto-roller/ensure", {
        method: "POST",
        body: JSON.stringify({
            capability: vocals ? "vocals" : "original",
            repair,
            ...(multilingual ? { multilingual } : {}),
        }),
    });
    latestPreparation = result;
    return result;
};

export async function waitForRuntime(
    vocals: boolean,
    current: () => boolean,
    repair = false,
    onState?: (state: Preparation) => void,
    multilingual = false,
): Promise<boolean> {
    let state = await ensureRuntime(vocals, repair, multilingual);
    while (current()) {
        onState?.(state);
        if (state.status === "failed") {
            throw new BackendApiError("Auto Timing could not be prepared.", {
                status: 503,
                backendMessage: { code: state.error || "runtime.prepare_failed" },
            });
        }
        if (
            state.status === "ready" && state.capabilities.includes(vocals ? "vocals" : "original")
            && (!multilingual || state.capabilities.includes("multilingual"))
        ) return true;
        await new Promise(resolve => setTimeout(resolve, 750));
        if (!current()) return false;
        state = await ensureRuntime(vocals, false, multilingual);
    }
    return false;
}
