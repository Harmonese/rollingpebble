import { request } from "./request.js";
import type { AutoRollerRuntime } from "./types.js";

export const autoRollerRuntime = (): Promise<AutoRollerRuntime> =>
    request<AutoRollerRuntime>("/api/runtime/auto-roller");
