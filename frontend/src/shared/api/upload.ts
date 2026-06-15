import { request } from "./request.js";
import type { UploadPlan, UploadRunResponse } from "./types.js";

export const uploadPlan = (projectId: string, payload: Record<string, unknown>): Promise<UploadPlan> =>
    request<UploadPlan>(`/api/projects/${projectId}/upload/plan`, {
        method: "POST",
        body: JSON.stringify(payload),
    });

export const uploadRun = (projectId: string, payload: Record<string, unknown>): Promise<UploadRunResponse> =>
    request<UploadRunResponse>(`/api/projects/${projectId}/upload/run`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
