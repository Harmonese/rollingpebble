import * as parser from "@lrc-maker/lrc-parser/build/esm/lrc-parser.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

let slots = [], cursor = 0, document;
const react = {
    useContext: () => ({ lang: { translation: {} } }),
    useState(initial) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
        return [slots[i], value => {
            slots[i] = typeof value === "function" ? value(slots[i]) : value;
        }];
    },
    useRef(initial) {
        const i = cursor++;
        return slots[i] ??= { current: initial };
    },
    useCallback: fn => fn,
    useEffect() {},
    useReducer(reducer, arg, init) {
        const [state, set] = react.useState(() => init(arg));
        return [state, action => set(value => reducer(value, action))];
    },
};
async function load(path, dependencies) {
    const source = await readFile(new URL("../src/" + path, import.meta.url), "utf8");
    const code = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports = {};
    new Function("require", "exports", code)(name => {
        if (!(name in dependencies)) throw Error("Unexpected dependency: " + name);
        return dependencies[name];
    }, exports);
    return exports;
}
const translation = await load("domain/lyrics/translationDocument.ts", {});
const engine = await load("domain/lyrics/useLyricsEngine.ts", {
    react,
    "@lrc-maker/lrc-parser": parser,
    "./translationDocument.js": translation,
});
const domain = await load("domain/lyrics/lyricsDocument.ts", {
    "@lrc-maker/lrc-parser": parser,
    "./useLyricsEngine.js": engine,
});
const lrc = await load("shared/lrc.ts", {});
const { useLyricsDocument } = await load("app/lyrics/useLyricsDocument.ts", {
    react,
    "../../shared/editorDraft.js": { editorDraftError: () => null },
    "../../domain/lyrics/translationDocument.js": translation,
    "../../shared/appContext.js": { appContext: {} },
    "../../ui/ConfirmDialog.js": { useConfirmDialog: () => async () => "confirm" },
    "@lrc-maker/lrc-parser": parser,
    "../../domain/audio/useAudioTimeline.js": { useAudioDurationEffect() {} },
    "../../domain/lyrics/lyricsDocument.js": domain,
    "../../hooks/useEditorMetadataSetting.js": { useEditorMetadataSetting: () => true },
    "../../shared/lrc.js": lrc,
    "../../storage/browserStorage.js": { editorStorageKeys: {}, readLocalText: () => "", readSessionNumber: () => 0 },
});
const options = { trimStart: true, trimEnd: true };
function render() {
    cursor = 0;
    document = useLyricsDocument({ trimOptions: options, prefState: { fixed: 2 } });
}
const A = engine.ActionType;
render();
document.rawDispatch({ type: A.info, payload: { name: "ti", value: "Audio" } });
document.updateSources({ track: "audio" });
render();
assert.equal(document.metadataSources.track, "audio");
// Editing only the lyric body must not turn automatic metadata into manual metadata.
document.dispatch({ type: A.parse, payload: { text: "[ti:Audio]\nChanged lyrics", options } });
render();
assert.equal(document.metadataSources.track, "audio");
document.dispatch({ type: A.info, payload: { name: "ti", value: "" } });
render();
assert.equal(document.metadataSources.track, "manual");
assert.equal(document.editorMeta.track, "");
document.importText("[ar:Lyric artist]\n[al:]\nNew lyrics", true);
render();
assert.equal(document.metadataSources.track, "manual");
assert.equal(document.metadataSources.artist, "lyrics");
assert.equal(document.metadataSources.album, "lyrics");
assert.equal(document.editorMeta.artist, "Lyric artist");
assert.equal(document.editorMeta.album, "");
const saved = {
    metadata: document.editorMeta,
    metadata_sources: document.metadataSources,
    synced_lyrics: document.syncedLyrics,
};
document.importProject(saved);
render();
assert.equal(document.editorMeta.track, "");
assert.deepEqual(document.metadataSources, saved.metadata_sources);
// Legacy values are protected; legacy empty fields remain fillable.
document.importProject({ metadata: { track: "Legacy", artist: "", album: "", duration: 0 }, synced_lyrics: "Line" });
render();
assert.equal(document.metadataSources.track, "manual");
assert.equal(document.metadataSources.artist, null);
document.dispatch({
    type: A.parse,
    payload: { text: "[ti:]\nImported", options, preserveMetadata: true, metadataOrigin: "lyrics" },
});
render();
assert.equal(document.editorMeta.track, "");
assert.equal(document.metadataSources.track, "lyrics");
document.importText("");
render();
assert.deepEqual(document.metadataSources, {});
assert.equal(document.editorMeta.track, "");
assert.equal(document.state.marks.length, 0);
console.log("Metadata sources: automatic, manual, lyrics, cleared values, reload, legacy and reset passed.");
