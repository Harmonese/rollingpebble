import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const code = ts.transpileModule(await readFile(new URL("../src/app/WorkspaceShell.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const workspace = {
    ready: true,
    panelSessionId: "draft-A",
    workspaceId: "audio-A",
    signature: "lyrics-A",
    project: null,
    lyrics: { state: { lyric: [] }, editorMeta: {}, plainLyrics: "", syncedLyrics: "" },
};
const jsx = (type, props, key = null) => ({ type, props, key });
const react = {
    useState: value => [value, () => {}],
    useRef: value => ({ current: value }),
    useEffect() {},
    useContext: () => ({ lang: { ui: {}, timingV2: {} }, prefState: {}, trimOptions: {} }),
};
const exports = {};
new Function("require", "exports", code)(name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name.includes("useProjectWorkspace")) return { useProjectWorkspace: () => workspace };
    if (name.includes("useTimingPreview")) return { useTimingPreview: () => ({ state: { lyric: [] }, flush() {} }) };
    if (name.includes("useTimingBinding")) return { useTimingBinding: () => "matched" };
    if (name.includes("useTranslation")) return { useTranslation() {} };
    if (name.includes("useTextFileDrop")) return { useTextFileDrop() {} };
    if (name.includes("ConfirmDialog")) return { useConfirmDialog: () => async () => "confirm" };
    if (name.includes("lyricsDocument")) return { lyricsDocumentSyncedText: () => "" };
    return new Proxy({}, { get: (_target, key) => key });
}, exports);
function nodes(tree, output = []) {
    if (Array.isArray(tree)) tree.forEach(child => nodes(child, output));
    else if (tree && typeof tree === "object") {
        output.push(tree);
        const children = tree.props?.children;
        if (Array.isArray(children)) {
            const keyed = children.filter(child => child && typeof child === "object" && child.key !== null);
            assert.equal(
                new Set(keyed.map(child => child.key)).size,
                keyed.length,
                `Duplicate sibling keys under ${tree.type}: ${
                    keyed.map(child => `${child.type}=${child.key}`).join(", ")
                }`,
            );
        }
        nodes(children, output);
    }
    return output;
}
function render() {
    const tree = nodes(exports.WorkspaceShell());
    const panels = ["ImportAudioPanel", "LrclibPanel", "UploadPanel"].map(type => {
        const found = tree.filter(node => node.type === type);
        assert.equal(found.length, 1, `${type} has exactly one render location`);
        assert.equal(found[0].props.panelSessionId, workspace.panelSessionId);
        return found[0];
    });
    assert.equal(new Set(panels.map(panel => panel.key)).size, panels.length);
    return panels.map(panel => panel.key);
}
const original = render();
workspace.project = { project_id: "saved-A" };
assert.deepEqual(render(), original, "first save preserves panel identity");
workspace.workspaceId = "replacement-audio";
assert.deepEqual(render(), original, "audio replacement preserves panel identity");
let previous = original;
for (const session of ["draft-B", "draft-C", "opened-A", "draft-D", "opened-B"]) {
    workspace.panelSessionId = session;
    const next = render();
    next.forEach((key, index) => assert.notEqual(key, previous[index], "new/opened projects reset each panel"));
    previous = next;
}
console.log(
    "Workspace panels: unique sibling keys across repeated new/open transitions; stable keys on first save and audio replacement passed.",
);
