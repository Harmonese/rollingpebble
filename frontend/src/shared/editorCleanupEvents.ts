export const EDITOR_LRC_CLEANUP_REQUEST_EVENT = "lrc-roller:editor-lrc-cleanup-request";

export type EditorLrcCleanupResult = {
    ok: boolean;
    message: string;
};

export type EditorLrcCleanupRequest = {
    removeTranslations: boolean;
    onResult?: (result: EditorLrcCleanupResult) => void;
};

export function requestEditorLrcCleanup(request: EditorLrcCleanupRequest): void {
    window.dispatchEvent(new CustomEvent<EditorLrcCleanupRequest>(EDITOR_LRC_CLEANUP_REQUEST_EVENT, { detail: request }));
}
