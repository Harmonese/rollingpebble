import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Run the workspace hook with controlled services, without browser data or a backend.
let slots = [], cursor = 0, effects = [], workspace, savedCount = 0, replacedCount = 0, confirms = 0;
const documentState = { info: new Map(), lyric: [{ text: "Keep", time: 1 }], marks: [{ id: 1, text: "Keep" }] };
const lyrics = {
    state: documentState,
    plainLyrics: "Keep",
    syncedLyrics: "[00:01.00]Keep",
    editorMeta: { track: "Manual title", artist: "", album: "", duration: 0 },
    dispatch: ({ payload }) => {
        documentState.info.set(payload.name, payload.value);
        const key = { ti: "track", ar: "artist", al: "album" }[payload.name];
        if (key) lyrics.editorMeta[key] = payload.value;
    },
    importText: () => {
        throw Error("Audio must not replace lyrics");
    },
};
const model = { project_id: "saved", metadata: lyrics.editorMeta, source: "manual" };
const mocks = {
    useState: initial => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], value => {
            slots[index] = typeof value === "function" ? value(slots[index]) : value;
        }];
    },
    useRef: initial => {
        const index = cursor++;
        return slots[index] ??= { current: initial };
    },
    useCallback: fn => fn,
    useEffect: fn => {
        effects.push(fn);
    },
    useLyricsDocument: () => lyrics,
    useConfirmDialog: () => async () => {
        confirms++;
        return "cancel";
    },
    hasLyricContent: text => Boolean(text),
    audioMetadata: async () => ({ track: "Audio title", artist: "Singer", album: "Album", duration: 12 }),
    saveWorkspace: async () => {
        savedCount++;
        return model;
    },
    replaceWorkspaceAudio: async () => {
        replacedCount++;
        return model;
    },
    applyLyrics: async () => model,
    notifyProjectsChanged: () => {},
    loadProjectAudioForPlayback: () => {},
    loadProjectAudioUrlForPlayback: () => {},
    PROJECTS_CHANGED_EVENT: "projects",
    LyricsDocumentActionType: { info: "info" },
    convertTimeToTag: value => String(value),
};
const source = await readFile(new URL("../src/app/projects/useProjectWorkspace.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
const previousWindow = globalThis.window;
globalThis.window = { addEventListener() {}, removeEventListener() {} };
try {
    new Function("require", "exports", compiled)(() => mocks, exports);
    const render = () => {
        cursor = 0;
        effects = [];
        workspace = exports.useProjectWorkspace({ trimOptions: {}, prefState: {}, lang: { ui: {} } });
        effects.forEach(fn => fn());
    };
    render();
    const originalLyrics = documentState.lyric, originalMarks = documentState.marks;
    await workspace.importAudio(new File(["first"], "song.wav"));
    render();
    assert.equal(confirms, 0);
    assert.equal(savedCount, 0);
    assert.equal(documentState.lyric, originalLyrics);
    assert.equal(documentState.marks, originalMarks);
    assert.equal(lyrics.editorMeta.track, "Manual title");
    assert.equal(lyrics.editorMeta.artist, "Singer");
    await workspace.save();
    render();
    assert.equal(workspace.dirty, false);
    const previousId = workspace.workspaceId, previousSignature = workspace.signature;
    await workspace.importAudio(new File(["other"], "song.wav"));
    render();
    assert.equal(workspace.project.project_id, "saved");
    assert.equal(workspace.dirty, true);
    assert.notEqual(workspace.signature, previousSignature);
    assert.equal(workspace.applyJobResult(previousId, previousSignature, model), false);
    assert.equal(confirms, 0);
    await workspace.save();
    render();
    assert.equal(replacedCount, 1);
    assert.equal(workspace.dirty, false);
    await workspace.save();
    assert.equal(replacedCount, 1);
    assert.equal(savedCount, 1);
    slots = [];
    render();
    let draft;
    mocks.saveWorkspace = async id => {
        draft = id;
        throw Error("Lost response");
    };
    mocks.getProject = async id => {
        assert.equal(id, draft.replaceAll("-", ""));
        return model;
    };
    await assert.rejects(workspace.save(), /Lost response/);
    render();
    await workspace.importAudio(new File(["replacement"], "new.wav"));
    render();
    const beforeRecovery = replacedCount;
    await workspace.save();
    render();
    assert.equal(replacedCount, beforeRecovery + 1);
    assert.equal(workspace.project.project_id, model.project_id);
    console.log(
        "Audio replacement: preserved lyrics/marks/metadata, dirty state, save routing and stale results passed.",
    );
} finally {
    globalThis.window = previousWindow;
}
