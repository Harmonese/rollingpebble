import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

let slots = [], cursor = 0, effects = [], queued = false, workspace;
let clock = 1, timers = new Map(), id = 0, listeners = new Map();
let saves = 0,
    replacements = 0,
    failed = false,
    delay = null,
    recovery = null,
    choice = "confirm",
    raw = null,
    invalid = null,
    lastConfirmation = null,
    missingProject = false;
const realNow = Date.now;
Date.now = () => clock;
globalThis.document = { querySelector: () => null };
globalThis.window = {
    addEventListener: (n, f) => listeners.set(n, f),
    removeEventListener: (n, f) => {
        if (listeners.get(n) === f) listeners.delete(n);
    },
    setTimeout: (f, ms) => {
        timers.set(++id, { f, at: clock + ms });
        return id;
    },
    clearTimeout: n => timers.delete(n),
};
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function queue() {
    if (!queued) {
        queued = true;
        queueMicrotask(() => {
            queued = false;
            render();
        });
    }
}
const lyrics = {
    plainLyrics: "Keep",
    syncedLyrics: "Keep",
    state: { lyric: [{ text: "Keep" }] },
    editorMeta: { track: "Manual", artist: "", album: "", duration: 1 },
    metadataSources: { track: "manual" },
    updateSources(v) {
        this.metadataSources = v;
    },
    rawDispatch({ type, payload }) {
        if (type === "info") {
            const field = { ti: "track", ar: "artist", al: "album" }[payload.name];
            if (field) this.editorMeta = { ...this.editorMeta, [field]: payload.value };
        }
    },
    importProject(p) {
        this.plainLyrics = p.plain_lyrics;
        this.syncedLyrics = p.synced_lyrics;
    },
    async importText() {
        this.plainLyrics = this.syncedLyrics = "";
    },
};
const model = {
    project_id: "a".repeat(12),
    metadata: lyrics.editorMeta,
    source: "manual",
    plain_lyrics: "Keep",
    synced_lyrics: "Keep",
};
async function save() {
    saves++;
    if (failed) throw Error("disk full");
    if (delay) await delay;
    return model;
}
const mocks = {
    useState(initial) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
        return [slots[i], v => {
            const n = typeof v === "function" ? v(slots[i]) : v;
            if (!Object.is(n, slots[i])) {
                slots[i] = n;
                queue();
            }
        }];
    },
    useRef(initial) {
        const i = cursor++;
        return slots[i] ??= { current: initial };
    },
    useCallback: f => f,
    useEffect(f, deps) {
        const i = cursor++;
        if (slots[i] && deps?.every((v, j) => Object.is(v, slots[i].deps[j]))) return;
        effects.push(() => {
            slots[i]?.cleanup?.();
            slots[i] = { deps, cleanup: f() };
        });
    },
    useLyricsDocument: () => lyrics,
    useConfirmDialog: () => async options => {
        lastConfirmation = options;
        return choice;
    },
    hasLyricContent: Boolean,
    editorDraftError: () => invalid,
    readEditorRecovery: () => raw,
    setEditorRecovery: v => {
        raw = v;
    },
    flushEditor: async () => {
        if (invalid) throw Error(invalid);
    },
    EDITOR_DRAFT_CHANGED: "draft",
    readRecovery: async () => recovery,
    writeRecovery: async v => {
        recovery = v;
    },
    clearRecovery: async () => {
        recovery = null;
    },
    recoveryAudio: async () => null,
    saveWorkspace: save,
    applyLyrics: save,
    getProject: async () => {
        if (missingProject) throw Object.assign(new Error("not found"), { status: 404 });
        return model;
    },
    replaceWorkspaceAudio: async () => {
        replacements++;
        return save();
    },
    audioMetadata: async () => ({ track: "Audio", artist: "Singer", album: "Album", duration: 12 }),
    notifyProjectsChanged() {},
    loadProjectAudioForPlayback() {},
    loadProjectAudioUrlForPlayback() {},
    PROJECTS_CHANGED_EVENT: "projects",
    LyricsDocumentActionType: { info: "info", select: "select" },
    convertTimeToTag: String,
};
const source = await readFile(new URL("../src/app/projects/useProjectWorkspace.ts", import.meta.url), "utf8");
const exports = {};
new Function(
    "require",
    "exports",
    ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } })
        .outputText,
)(() => mocks, exports);
function render() {
    cursor = 0;
    effects = [];
    workspace = exports.useProjectWorkspace({ trimOptions: {}, prefState: {}, lang: { ui: {} } });
    effects.forEach(f => f());
}
async function advance(ms) {
    clock += ms;
    for (const [key, timer] of [...timers]) {
        if (timer.at <= clock) {
            timers.delete(key);
            timer.f();
        }
    }
    await tick();
    await tick();
}
function edit(text) {
    lyrics.plainLyrics = lyrics.syncedLyrics = text;
    render();
}
render();
await tick();
assert.equal(workspace.ready, true);
const firstPanelSession = workspace.panelSessionId;
await workspace.importAudio(new File(["audio"], "first.wav"));
await tick();
await advance(1500);
assert.equal(saves, 0);
assert.equal(recovery.audio_name, "first.wav");
assert.equal(workspace.panelSessionId, firstPanelSession);
assert.equal(lyrics.editorMeta.track, "Manual");
await workspace.save();
await tick();
assert.equal(workspace.dirty, false);
assert.equal(workspace.panelSessionId, firstPanelSession);
await advance(500);
assert.equal(recovery.audio_key, null);
edit("Auto save");
await advance(999);
assert.equal(saves, 1);
await advance(1);
assert.equal(saves, 2);
const beforeContinuous = saves;
for (let n = 0; n < 12; n++) {
    edit(`Continuous ${n}`);
    await advance(900);
}
assert.ok(saves > beforeContinuous);
failed = true;
edit("Failure");
await advance(1000);
assert.equal(workspace.saveError, true);
const failedCount = saves;
edit("After failure");
await advance(20000);
assert.equal(saves, failedCount);
failed = false;
await workspace.save();
await tick();
assert.equal(workspace.dirty, false);
let release;
delay = new Promise(r => {
    release = r;
});
edit("Before pending");
const pending = workspace.save();
await tick();
edit("During pending");
release();
delay = null;
await pending;
await tick();
assert.equal(workspace.dirty, false);
await workspace.importAudio(new File(["new"], "new.wav"));
await tick();
await advance(1000);
assert.equal(replacements, 1);
edit("Shortcut");
let prevented = false;
listeners.get("keydown")({
    code: "KeyS",
    ctrlKey: true,
    preventDefault() {
        prevented = true;
    },
});
await tick();
await tick();
assert.ok(prevented);
assert.equal(workspace.dirty, false);
invalid = "Invalid timestamp";
raw = { mode: "paired", texts: ["[bad]", "译文"] };
listeners.get("draft")();
await tick();
await advance(1000);
assert.deepEqual(recovery.editor, raw);
choice = "cancel";
assert.equal(await workspace.prepareExit(async () => {}), false);
invalid = null;
raw = null;
await workspace.save();
await tick();
failed = true;
edit("Keep on failure");
await assert.rejects(workspace.newProject(), /disk full/);
assert.equal(lyrics.plainLyrics, "Keep on failure");
failed = false;
await workspace.newProject();
await tick();
assert.equal(workspace.project, null);
assert.notEqual(workspace.panelSessionId, firstPanelSession);
const secondPanelSession = workspace.panelSessionId;
await workspace.importAudio(new File(["next"], "next.wav"));
await tick();
choice = "cancel";
assert.equal(await workspace.newProject(), false);
assert.equal(workspace.panelSessionId, secondPanelSession);
choice = "discard";
assert.equal(await workspace.newProject(), true);
await tick();
assert.equal(workspace.file, null);
assert.notEqual(workspace.panelSessionId, secondPanelSession);
// A lost first-save response reuses the recovered project rather than creating another.
await workspace.importAudio(new File(["retry"], "retry.wav"));
await tick();
mocks.saveWorkspace = async () => {
    throw Error("Lost response");
};
await assert.rejects(workspace.save(), /Lost response/);
await tick();
const beforeRetry = replacements;
await workspace.save();
await tick();
assert.equal(replacements, beforeRetry + 1);
// A late metadata response cannot resurrect a deleted workspace.
let finishMetadata;
mocks.audioMetadata = () =>
    new Promise(resolve => {
        finishMetadata = resolve;
    });
const importing = workspace.importAudio(new File(["late"], "late.wav"));
while (!finishMetadata) await tick();
listeners.get("projects")({ detail: [model.project_id] });
await tick();
finishMetadata({ track: "Late", artist: "", album: "", duration: 1 });
assert.equal(await importing, false);
await tick();
assert.equal(workspace.file, null);
// Reopen an unfinished workspace, preserving the raw invalid editor text.
for (const slot of slots) slot?.cleanup?.();
slots = [];
timers.clear();
recovery = {
    version: 1,
    project_id: model.project_id,
    draft_id: crypto.randomUUID(),
    snapshot: { ...model, metadata_sources: {} },
    dirty: true,
    audio_key: null,
    editor: { mode: "paired", texts: ["[bad]", "译文"] },
};
choice = "confirm";
render();
await tick();
await tick();
assert.equal(workspace.ready, true);
assert.equal(raw.mode, "paired");
assert.equal(workspace.project.project_id, model.project_id);
raw = null;
await workspace.save();
await tick();
assert.equal(await workspace.prepareExit(async () => {}), true);
// Explicit discard restores the saved version; interrupted prompts remain retryable.
async function reopen(answer, { missing = false, clean = false } = {}) {
    for (const slot of slots) slot?.cleanup?.();
    slots = [];
    timers.clear();
    raw = null;
    missingProject = missing;
    lastConfirmation = null;
    recovery = {
        version: 1,
        project_id: missing ? null : model.project_id,
        draft_id: crypto.randomUUID(),
        snapshot: { ...model, plain_lyrics: "Unsaved edits", synced_lyrics: "Unsaved edits", metadata_sources: {} },
        dirty: !clean,
        audio_key: null,
        editor: { mode: "plain", text: "Unsaved edits" },
    };
    choice = answer;
    render();
    await tick();
    await tick();
}
await reopen("discard");
assert.equal(lastConfirmation.requireDecision, true);
assert.equal(workspace.ready, true);
assert.equal(workspace.restorePending, false);
assert.equal(workspace.project.project_id, model.project_id);
assert.equal(lyrics.plainLyrics, model.plain_lyrics);
assert.equal(raw, null);
assert.equal(recovery, null);
await reopen("discard", { missing: true });
assert.equal(workspace.ready, true);
assert.equal(workspace.project, null);
assert.equal(lyrics.plainLyrics, "");
assert.equal(recovery, null);
await reopen("cancel");
assert.equal(workspace.ready, false);
assert.equal(workspace.restorePending, true);
assert.equal(recovery.snapshot.plain_lyrics, "Unsaved edits", "an interrupted decision must preserve recovery");
choice = "confirm";
workspace.retryRecovery();
await tick();
await tick();
assert.equal(workspace.ready, true);
assert.equal(workspace.restorePending, false);
assert.equal(lyrics.plainLyrics, "Unsaved edits");
await reopen("cancel", { clean: true });
assert.equal(workspace.ready, true, "clean saved workspaces reopen without asking");
assert.equal(lastConfirmation, null);
Date.now = realNow;
console.log(
    "Autosave debounce/deadline, recovery, shortcuts, audio replacement, concurrent edits, save failures and exit guards passed.",
);
