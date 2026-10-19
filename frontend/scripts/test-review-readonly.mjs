import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
let slots = [], cursor = 0, effects = [], cleanups = [];
const actions = [], events = new Map();
const audio = {
    duration: 100,
    currentTime: 5,
    step() {
        throw new Error("Unexpected audio seek");
    },
};
const prefState = { fixed: 2, screenButton: true };
const react = {
    memo: fn => fn,
    useCallback: fn => fn,
    useContext: () => ({ prefState, lang: { ui: {}, translation: {} }, trimOptions: {} }),
    useMemo: fn => fn(),
    useRef: value => slots[cursor++] ??= { current: value },
    useState(value) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = typeof value === "function" ? value() : value;
        return [slots[i], next => {
            slots[i] = typeof next === "function" ? next(slots[i]) : next;
        }];
    },
    useEffect(fn, deps) {
        const i = cursor++, previous = slots[i];
        if (!previous || deps.some((v, n) => v !== previous[n])) {
            cleanups[i]?.();
            slots[i] = deps;
            effects.push(() => {
                cleanups[i] = fn();
            });
        }
    },
};
const jsx = (type, props) => ({ type, props });
const types = new Proxy({}, { get: (_, key) => key });
let subscribers = 0;
const common = name => {
    if (name.includes("editorDraft")) return { editorDraftError: () => null };
    if (name.includes("ConfirmDialog")) return { useConfirmDialog: () => async () => "confirm" };
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name.includes("lyricsDocument")) {
        return {
            LyricsDocumentActionType: types,
            convertTimeToTag: t => `[${t}]`,
            formatText: t => t,
            lyricsDocumentSyncedText: () => "[00:01.00]Line",
        };
    }
    if (name.includes("useAudio")) return { useAudio: () => audio };
    if (name.includes("useKeyBindings")) return { useKeyBindings: () => [] };
    if (name.includes("appContext")) return { appContext: {}, AppContextBits: {} };
    if (name.includes("audioPlaybackEvents")) {
        return {
            currentTimePubSub: {
                sub() {
                    subscribers++;
                    return () => subscribers--;
                },
            },
        };
    }
    if (name.includes("browserStorage")) return { readSessionText: () => null, writeSessionText() {} };
    if (name.includes("syncMode")) return { SyncMode: { highlight: 1, select: 0 } };
    if (name.includes("lyricsFileName")) return { lrcFileName: () => "lyrics.lrc" };
    if (name.includes("input-action")) return { InputAction: {} };
    return { default: {} };
};
async function compile(path, require = common) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    const output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            jsx: ts.JsxEmit.ReactJSX,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText;
    const exports = {};
    new Function("require", "exports", output)(require, exports);
    return exports;
}
function reset() {
    cleanups.forEach(fn => fn?.());
    slots = [];
    cleanups = [];
    effects = [];
    actions.length = 0;
}
function render(fn) {
    cursor = 0;
    effects = [];
    const tree = fn();
    effects.forEach(fn => fn());
    return tree;
}
function nodes(tree) {
    if (!tree || typeof tree !== "object") return [];
    return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
globalThis.document = {
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: name => events.delete(name),
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };
const { LyricsSynchronizer } = await compile("../src/features/lyrics/LyricsSynchronizer.tsx");
const state = { selectIndex: 0, currentIndex: 0, lyric: [{ text: "Line", time: 1 }], marks: [], info: new Map() };
const dispatch = a => actions.push(a);
let tree = render(() => LyricsSynchronizer({ state, dispatch, readOnly: true }));
assert.equal(actions.length, 0);
assert.equal(subscribers, 0);
assert.equal(events.has("keydown"), false);
const ul = nodes(tree).find(n => n.type === "ul");
assert.equal(nodes(ul).filter(n => n.type === "li").length, 0); // No placeholder; lyric rows are components.
ul.props.onDoubleClickCapture({
    stopPropagation() {},
    target: { classList: { contains: () => true }, dataset: { key: "0" } },
});
assert.equal(actions.length, 0);
ul.props.onClickCapture({
    stopPropagation() {},
    target: { classList: { contains: () => true }, dataset: { key: "0" } },
});
assert.equal(actions.at(-1).type, "select");
const row = nodes(ul).find(n => typeof n.type === "function");
assert.equal(nodes(row.type(row.props)).some(n => n.props?.fixed !== undefined), false);
render(() => LyricsSynchronizer({ state, dispatch, readOnly: false }));
assert.equal(subscribers, 1);
assert.equal(events.has("keydown"), true);
render(() => LyricsSynchronizer({ state, dispatch, readOnly: true }));
assert.equal(subscribers, 0);
assert.equal(events.has("keydown"), false);
reset();
const { LyricsEditor } = await compile("../src/features/lyrics/LyricsEditor.tsx");
tree = render(() =>
    LyricsEditor({
        lrcState: state,
        lrcDispatch: dispatch,
        readOnly: true,
        onOpenUtils() {
            throw new Error("Unexpected tools");
        },
    })
);
const textarea = nodes(tree).find(n => n.type === "textarea");
assert.equal(textarea.props.readOnly, true);
textarea.props.onBlur({ target: { value: "Changed" } });
const file = nodes(tree).find(n => n.props?.type === "file");
assert.equal(file.props.disabled, true);
file.props.onChange({ target: { files: [{}] } });
assert.equal(actions.length, 0);
reset();
const pending = [];
const { useTimingBinding } = await compile(
    "../src/features/roller/controllers/useTimingBinding.ts",
    name =>
        name === "react"
            ? react
            : { timingBinding: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
);
let args = ["run", "project", "project", "workspace", false, "a.mp3"];
const binding = () => render(() => useTimingBinding(...args));
assert.equal(binding(), "checking");
pending[0].resolve({ matches: true });
await Promise.resolve();
assert.equal(binding(), "matched");
args[4] = true;
assert.equal(binding(), "mismatched");
args[4] = false;
args[5] = "b.mp3";
assert.equal(binding(), "checking");
args[0] = "next";
assert.equal(binding(), "checking");
pending[1].resolve({ matches: true });
await Promise.resolve();
assert.equal(binding(), "checking");
pending[2].reject(new Error("offline"));
await Promise.resolve();
await Promise.resolve();
assert.equal(binding(), "failed");
args[0] = "run";
args[5] = "a.mp3";
assert.equal(binding(), "checking");
pending[3].resolve({ matches: true });
await Promise.resolve();
assert.equal(binding(), "matched");
console.log("Read-only review rendering, edit guards, audio isolation and binding races passed");
