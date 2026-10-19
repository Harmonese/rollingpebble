import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
let slots = [], cursor = 0, effects = [], hook;
const actions = [], pendingGets = [];
let starts = 0, cancels = 0, workspace = "a";
let draftError = null;
let state = { lyric: [{ id: "one", text: "One", time: 1 }], info: new Map(), selectIndex: 0 };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const react = {
    useContext: () => ({ lang: { translation: {}, backendMessages: {} }, prefState: { lang: "zh" } }),
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
            slots[i] = deps;
            effects.push(fn);
        }
    },
};
const jobs = new Map();
const api = {
    async startTranslation(input) {
        starts++;
        if (!jobs.has(input.request_id)) jobs.set(input.request_id, { id: input.request_id, status: "running" });
        return jobs.get(input.request_id);
    },
    getTranslation(id) {
        return new Promise(resolve => pendingGets.push({ id, resolve }));
    },
    async cancelTranslation(id) {
        cancels++;
        const result = { id, status: "canceled" };
        jobs.set(id, result);
        return result;
    },
};
async function compile(path, dependencies) {
    const output = ts.transpileModule(await readFile(new URL("../src/" + path, import.meta.url), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports = {};
    new Function("require", "exports", output)(name => {
        if (!(name in dependencies)) throw Error(name);
        return dependencies[name];
    }, exports);
    return exports;
}
const doc = await compile("domain/lyrics/translationDocument.ts", {});
const { useTranslation } = await compile("features/translation/useTranslation.ts", {
    react,
    "../../shared/editorDraft.js": { editorDraftError: () => draftError },
    "../../domain/lyrics/lyricsDocument.js": { LyricsDocumentActionType: { translate: "translate" } },
    "../../domain/lyrics/translationDocument.js": doc,
    "../../shared/api/translation.js": api,
    "../../shared/api/request.js": { BackendApiError: class extends Error {}, backendMessageText: e => String(e) },
    "../../shared/appContext.js": {},
    "../../ui/ConfirmDialog.js": { useConfirmDialog: () => async () => "confirm" },
});
function render() {
    cursor = 0;
    effects = [];
    hook = useTranslation(state, action => actions.push(action), workspace);
    effects.forEach(fn => fn());
}
const tick = () => new Promise(resolve => setTimeout(resolve, 550));
const finish = (get, text) => get.resolve({ id: get.id, status: "succeeded", result: [{ id: "one", text }] });
render();
const first = hook.run();
await hook.run();
assert.equal(starts, 1);
await tick();
state = { ...state, lyric: [{ ...state.lyric[0], time: 4 }] };
render();
assert.equal(cancels, 0);
finish(pendingGets.shift(), "译文");
await first;
assert.equal(actions.length, 1);
render();
const second = hook.run();
await tick();
const stale = pendingGets.shift();
state = { ...state, lyric: [{ ...state.lyric[0], text: "Edited" }] };
render();
await Promise.resolve();
assert.equal(cancels, 1);
render();
const third = hook.run();
await tick();
finish(stale, "Must not overwrite");
await second;
finish(pendingGets.shift(), "New translation");
await third;
assert.equal(actions.length, 2);
assert.equal(actions[1].payload.lines[0].text, "New translation");
render();
const fourth = hook.run();
await tick();
workspace = "different";
render();
finish(pendingGets.shift(), "Wrong project");
await fourth;
assert.equal(actions.length, 2);
assert.equal(cancels, 2);
render();
const fifth = hook.run();
await tick();
draftError = "Fix timestamp";
const waiting = pendingGets.shift();
const result = { id: waiting.id, status: "succeeded", result: [{ id: "one", text: "Preserved result" }] };
jobs.set(waiting.id, result);
waiting.resolve(result);
await fifth;
assert.equal(actions.length, 2);
render();
assert.equal(hook.busy, false);
draftError = null;
await hook.retry();
assert.equal(actions.length, 3);
assert.equal(actions[2].payload.lines[0].text, "Preserved result");
console.log(
    "Translation task deduplication, timing-only edits, edit cancellation, stale polling and workspace guards passed.",
);
