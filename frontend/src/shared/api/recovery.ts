import type { EditorRecovery } from "../editorDraft.js";
import type { WorkspaceSnapshot } from "./projects.js";
import { request } from "./request.js";

export type Recovery = {
    version: 1;
    project_id: string | null;
    draft_id: string;
    snapshot: WorkspaceSnapshot;
    dirty: boolean;
    audio_key: string | null;
    audio_name: string | null;
    editor: EditorRecovery | null;
};
const headers = { "x-rollingpebble-client": "workspace" };
export const readRecovery = () => request<Recovery | null>("/api/workspace/recovery");
export const clearRecovery = () => request("/api/workspace/recovery", { method: "DELETE", headers });
export function writeRecovery(record: Recovery, audio: File | null) {
    const body = new FormData();
    body.append("record", JSON.stringify(record));
    if (audio) body.append("audio", audio);
    return request<Recovery>("/api/workspace/recovery", { method: "PUT", headers, body });
}
export async function recoveryAudio(record: Recovery): Promise<File | null> {
    if (!record.audio_key) return null;
    const response = await fetch(`/api/workspace/recovery/audio/${record.audio_key}`);
    if (!response.ok) throw new Error("Recovery audio is missing");
    return new File([await response.blob()], record.audio_name || "audio");
}
