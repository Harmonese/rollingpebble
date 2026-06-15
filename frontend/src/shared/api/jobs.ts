import { request } from "./request.js";
import type { JobModel } from "./types.js";

export const getJob = (jobId: string): Promise<JobModel> => request<JobModel>(`/api/jobs/${jobId}`);

export const cancelJob = (jobId: string): Promise<JobModel> =>
    request<JobModel>(`/api/jobs/${jobId}/cancel`, { method: "POST" });

export const openJobFolder = (jobId: string): Promise<{ status: string; path: string }> =>
    request<{ status: string; path: string }>(`/api/jobs/${jobId}/open-folder`, { method: "POST" });
