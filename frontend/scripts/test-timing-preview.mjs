import * as parser from "@lrc-maker/lrc-parser/build/esm/lrc-parser.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

let slots = [], cursor = 0, effects = [], dirty = false, hook;
const trimOptions = { trimStart: true, trimEnd: true };
const react = {
    useState(initial) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
        return [slots[i], value => {
            const next = typeof value === "function" ? value(slots[i]) : value;
            if (next !== slots[i]) {
                slots[i] = next;
                dirty = true;
            }
        }];
    },
    useRef(initial) {
        return slots[cursor++] ??= { current: initial };
    },
    useCallback(fn) {
        return fn;
    },
    useContext() {
        return { trimOptions };
    },
    useEffect(fn, deps) {
        const i = cursor++, previous = slots[i];
        if (!previous || deps.some((value, index) => value !== previous[index])) {
            slots[i] = deps;
            effects.push(fn);
        }
    },
};
async function compile(path, require) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    const result = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    });
    const exports = {};
    new Function("require", "exports", result.outputText)(require, exports);
    return exports;
}
const translation = await compile("../src/domain/lyrics/translationDocument.ts", () => ({}));
const engine = await compile(
    "../src/domain/lyrics/useLyricsEngine.ts",
    name => name === "react" ? react : name.includes("translationDocument") ? translation : parser,
);
const timing = await compile("../src/shared/api/timingV2.ts", () => ({}));
const stored = new Map();
let fail = false, loseResponse = false, writes = 0, loadFail = false, saveGate = null;
const api = {
    reviewLines: timing.reviewLines,
    async getDraft(id) {
        if (loadFail) throw new Error("load offline");
        return structuredClone(stored.get(id) || { version: 0, base_revision: 0, lines: null });
    },
    async saveDraft(id, value) {
        if (saveGate) await saveGate;
        if (fail) throw new Error("offline");
        assert.equal(value.version, (stored.get(id) || { version: 0 }).version);
        const saved = { ...structuredClone(value), version: value.version + 1 };
        stored.set(id, saved);
        writes++;
        if (loseResponse) {
            loseResponse = false;
            throw new Error("lost response");
        }
        return saved;
    },
};
const module = await compile(
    "../src/features/roller/controllers/useTimingPreview.ts",
    name => name === "react" ? react : name.includes("useLyricsEngine") ? engine : name.includes("timingV2") ? api : {},
);
let run = { id: "one", snapshot: { revision: 1, lines: [{ text: "First", start: 0 }, { text: "Second", start: 3 }] } };
function render() {
    cursor = 0;
    effects = [];
    dirty = false;
    hook = module.useTimingPreview(run);
    effects.forEach(fn => fn());
}
async function settle() {
    for (let i = 0; i < 12; i++) {
        await Promise.resolve();
        if (dirty) render();
    }
}
render();
await settle();
assert.equal(hook.loaded, true);
assert.equal(hook.state.lyric[0].time, 0);
hook.dispatch({ type: engine.ActionType.markLine, payload: {} });
await settle();
assert.equal(hook.edited, false);
assert.equal(writes, 0);
hook.dispatch({ type: engine.ActionType.time, payload: 1.2 });
await hook.flush();
await settle();
assert.equal(hook.edited, true);
assert.equal(stored.get("one").base_revision, 1);
const id = stored.get("one").lines[0].id;
run = { ...run, snapshot: { revision: 2, lines: [{ text: "New snapshot", start: 5 }] } };
render();
await settle();
assert.equal(hook.state.lyric[0].text, "First");
hook.dispatch({ type: engine.ActionType.time, payload: 1.5 });
await hook.flush();
await settle();
assert.equal(stored.get("one").lines[0].id, id);
loseResponse = true;
hook.dispatch({ type: engine.ActionType.deleteLine, payload: undefined });
await assert.rejects(hook.flush(), /lost response/);
await settle();
assert.ok(hook.error);
await hook.retrySave();
await hook.flush();
await settle();
assert.equal(hook.error, "");
assert.equal(stored.get("one").lines.length, 1);
await hook.useLatest();
await settle();
assert.equal(hook.edited, false);
assert.equal(hook.state.lyric[0].text, "New snapshot");
assert.equal(stored.get("one").lines, null);
fail = true;
hook.dispatch({ type: engine.ActionType.time, payload: 6 });
await assert.rejects(hook.flush(), /offline/);
await settle();
assert.equal(hook.edited, true);
fail = false;
await hook.retrySave();
await hook.flush();
await settle();
slots = [];
render();
await settle();
assert.equal(hook.edited, true);
assert.equal(hook.state.lyric[0].time, 6);
run = { id: "two", snapshot: { revision: 1, lines: [] } };
render();
await settle();
assert.equal(hook.edited, false);
assert.deepEqual(hook.state.lyric, []);
assert.equal(hook.state.marks.length, 0);
console.log(
    "Preview: snapshot replacement, freeze, stable IDs, autosave, lost-response retry, restart and session isolation passed.",
);

// A failed first read must retry reading; it must never overwrite a stored draft.
stored.set("load-retry", { version: 4, base_revision: 1, lines: [{ id: "saved", text: "Keep me", time: 7 }] });
loadFail = true;
run = { id: "load-retry", snapshot: { revision: 1, lines: [] } };
render();
assert.equal(hook.loaded, false, "Previous task readiness must not leak into the new task render");
await settle();
assert.ok(hook.error);
const writesBeforeRetry = writes;
loadFail = false;
await hook.retrySave();
await settle();
assert.equal(hook.loaded, true);
assert.equal(hook.state.lyric[0].text, "Keep me");
assert.equal(writes, writesBeforeRetry);

// Use Latest cannot overwrite a new task after its old save finishes.
let release;
saveGate = new Promise(resolve => {
    release = resolve;
});
const pendingLatest = hook.useLatest();
await settle();
const beforeLockedEdit = hook.currentState().lyric;
hook.dispatch({ type: engine.ActionType.deleteLine, payload: undefined });
assert.equal(hook.currentState().lyric, beforeLockedEdit);
run = { id: "new-run", snapshot: { revision: 1, lines: [{ text: "New task", start: 9 }] } };
render();
await settle();
release();
saveGate = null;
await pendingLatest;
await settle();
assert.equal(hook.state.lyric[0].text, "New task");
assert.equal(hook.saving, false);

// A revision received while restoring the engine view is not lost.
hook.dispatch({ type: engine.ActionType.time, payload: 10 });
await hook.flush();
await settle();
saveGate = new Promise(resolve => {
    release = resolve;
});
const latestWithRevision = hook.useLatest();
await settle();
run = { ...run, snapshot: { revision: 2, lines: [{ text: "Newest", start: 11 }] } };
render();
await settle();
release();
saveGate = null;
await latestWithRevision;
await settle();
assert.equal(hook.edited, false);
assert.equal(hook.state.lyric[0].text, "Newest");
console.log("Review load retries, task switches during Use Latest, editing locks and concurrent revisions passed");
run = {
    id: "ordered",
    snapshot: {
        revision: 1,
        alignment_mode: "ordered",
        lines: [{ text: "Repeat", start: 0, input_line_index: 0 }, { text: "Last", start: 12, input_line_index: 3 }],
        unaligned_lines: [{ text: "Repeat", input_line_index: 2, reason: "pending_audio" }],
    },
};
render();
await settle();
assert.deepEqual(hook.state.lyric.map(line => [line.text, line.time]), [["Repeat", 0], ["Repeat", undefined], [
    "Last",
    12,
]]);
const exported = parser.stringify(hook.state, { fixed: 2, spaceStart: false, spaceEnd: false });
const restored = engine.init(() => ({ text: exported, options: trimOptions, select: 0 }));
assert.deepEqual(restored.lyric.map(line => [line.text, line.time]), [["Repeat", 0], ["Repeat", undefined], [
    "Last",
    12,
]]);
hook.dispatch({ type: engine.ActionType.select, payload: () => 1 });
hook.dispatch({ type: engine.ActionType.time, payload: 6 });
await hook.flush();
await settle();
assert.equal(stored.get("ordered").lines[1].time, 6);
run = {
    ...run,
    snapshot: {
        ...run.snapshot,
        revision: 2,
        lines: [{ text: "Repeat", start: 0, input_line_index: 0 }, { text: "Repeat", start: 7, input_line_index: 2 }, {
            text: "Last",
            start: 12,
            input_line_index: 3,
        }],
        unaligned_lines: [],
    },
};
render();
await settle();
assert.equal(hook.state.lyric[1].time, 6);
await hook.useLatest();
await settle();
assert.equal(hook.state.lyric[1].time, 7);
console.log("Ordered repetition, unresolved rows, serialization, draft freeze and Use Latest passed");
