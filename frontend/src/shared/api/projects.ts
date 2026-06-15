import { request } from "./request.js";
import type { MetaModel, ProjectModel } from "./types.js";

export function createProject(audio: File): Promise<ProjectModel> {
    const form = new FormData();
    form.append("audio", audio);
    return request<ProjectModel>("/api/projects", { method: "POST", body: form });
}

export const listProjects = (): Promise<ProjectModel[]> => request<ProjectModel[]>("/api/projects");

export const getProject = (projectId: string): Promise<ProjectModel> =>
    request<ProjectModel>(`/api/projects/${projectId}`);

export const deleteProject = (projectId: string): Promise<{ deleted: string }> =>
    request<{ deleted: string }>(`/api/projects/${projectId}`, { method: "DELETE" });

export const projectAudioUrl = (projectId: string): string => `/api/projects/${projectId}/audio`;

export const openProjectFolder = (projectId: string): Promise<{ status: string; path: string }> =>
    request<{ status: string; path: string }>(`/api/projects/${projectId}/open-folder`, { method: "POST" });

export const openProjectsFolder = (): Promise<{ status: string; path: string }> =>
    request<{ status: string; path: string }>("/api/storage/projects/open-folder", { method: "POST" });

export const applyLyrics = (projectId: string, payload: Partial<ProjectModel>): Promise<ProjectModel> =>
    request<ProjectModel>(`/api/projects/${projectId}/lyrics`, { method: "POST", body: JSON.stringify(payload) });

export const saveEditor = (
    projectId: string,
    payload: { plain_lyrics: string; synced_lyrics: string; metadata: MetaModel },
): Promise<ProjectModel> =>
    request<ProjectModel>(`/api/projects/${projectId}/editor`, { method: "POST", body: JSON.stringify(payload) });
