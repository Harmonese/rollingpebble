let validate: (() => string | null) | null = null;
export type EditorRecovery = { mode: "text" | "paired"; texts: string[] };
let draft: EditorRecovery | null = null;
let flush: (() => Promise<void>) | null = null;
export const EDITOR_DRAFT_CHANGED = "rollingpebble:editor-draft";
export const readEditorRecovery = () => draft;
export function setEditorRecovery(value: EditorRecovery | null) {
    if (JSON.stringify(value) === JSON.stringify(draft)) return;
    draft = value;
    window.dispatchEvent(new Event(EDITOR_DRAFT_CHANGED));
}
export function registerEditorCommit(commit: () => Promise<void>) {
    flush = commit;
    return () => {
        if (flush === commit) flush = null;
    };
}
let committing: Promise<void> | null = null;
export const flushEditor = () => {
    if (committing) return committing;
    committing = Promise.resolve().then(() => flush?.()).finally(() => {
        committing = null;
    });
    return committing;
};

/** An uncommitted timestamp must not disappear on save or workspace navigation. */
export function registerEditorDraft(check: () => string | null) {
    validate = check;
    return () => {
        if (validate === check) validate = null;
    };
}
export const editorDraftError = () => validate?.() || null;
