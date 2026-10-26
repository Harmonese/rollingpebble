import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const retryExports = {};
new Function(
    "require",
    "exports",
    ts.transpileModule(
        await readFile(new URL("../src/features/roller/retryEligibility.ts", import.meta.url), "utf8"),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText,
)(
    () => ({ isRunActive: value => Boolean(value && ["running", "queued", "cancelling"].includes(value.status)) }),
    retryExports,
);

const lang = JSON.parse(await readFile(new URL("../src/languages/en-US.json", import.meta.url), "utf8"));
const code =
    ts.transpileModule(await readFile(new URL("../src/features/roller/RollerPanel.tsx", import.meta.url), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
let slots = [], cursor = 0, effects = [], projects, history, batch, confirmResult, deletes, starts;
let resolvePreparation, preparationState, failPreparation, pendingSubmission, resolveSubmission;
const options = { language: "auto", audio_mode: "original" };
const target = new EventTarget();
globalThis.window = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    setInterval: () => 0,
    clearInterval() {},
    setTimeout: () => 0,
    clearTimeout() {},
};
const react = {
    useState(value) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value;
        return [slots[index], value => {
            slots[index] = typeof value === "function" ? value(slots[index]) : value;
        }];
    },
    useRef(value) {
        return slots[cursor++] ??= { current: value };
    },
    useContext: () => ({ lang }),
    useEffect(callback, deps) {
        const index = cursor++;
        const previous = slots[index];
        if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
            previous?.cleanup?.();
            slots[index] = { deps };
            effects.push(() => {
                slots[index].cleanup = callback();
            });
        }
    },
};
const jsx = (type, props) => ({ type, props });
const exports = {};
new Function("require", "exports", code)(name => {
    if (name.includes("retryEligibility")) return retryExports;
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name.includes("useAutoTimingState")) return { useAutoTimingState: () => ({ options }) };
    if (name.includes("useSettingsUpdated")) return { useSettingsUpdated() {} };
    if (name.includes("projectEvents")) return { PROJECTS_CHANGED_EVENT: "projects-changed" };
    if (name.includes("api/projects")) return { listProjects: async () => projects };
    if (name.includes("runtimePreparation")) {
        return {
            waitForRuntime: async (_vocals, current, _repair, onState) => {
                preparationState = onState;
                onState({ status: "checking" });
                await new Promise(resolve => {
                    resolvePreparation = resolve;
                });
                if (failPreparation) throw new Error("Preparation failed");
                return current();
            },
        };
    }
    if (name.includes("timingV2")) {
        return {
            TIMING_DELETED_EVENT: "timing-deleted",
            isRunActive: item => Boolean(item && ["queued", "running", "cancelling"].includes(item.status)),
            timingHistory: async () => history,
            getBatch: async () => batch,
            startBatch: async ids => {
                starts.push(ids);
                if (pendingSubmission) {
                    await new Promise(resolve => {
                        resolveSubmission = resolve;
                    });
                }
                return { ...batch, id: "next", status: "queued" };
            },
            deleteTiming: async (id, kind) => {
                deletes.push([id, kind]);
                const ids = kind === "batch" ? [batch.id, ...batch.children] : [id];
                if (kind === "run" && batch.children.length === 1) ids.push(batch.id);
                for (const removed of ids) {
                    history = history.filter(row => row.id !== removed);
                    target.dispatchEvent(new CustomEvent("timing-deleted", { detail: removed }));
                }
            },
        };
    }
    if (name.includes("ConfirmDialog")) return { useConfirmDialog: () => async () => confirmResult };
    if (name.includes("request")) {
        return {
            BackendApiError: class extends Error {},
            backendMessageText: error => error.message,
        };
    }
    return new Proxy({}, { get: (_target, key) => key });
}, exports);
const props = {
    project: null,
    workspaceId: "workspace",
    workspaceSignature: "lyrics",
    workspaceBusy: false,
    canStart: true,
};
function nodes(tree, result = []) {
    if (Array.isArray(tree)) tree.forEach(item => nodes(item, result));
    else if (tree && typeof tree === "object") {
        result.push(tree);
        nodes(tree.props?.children, result);
    }
    return result;
}
function render() {
    cursor = 0;
    const tree = nodes(exports.RollerPanel(props));
    effects.splice(0).forEach(effect => effect());
    return tree;
}
const find = (type, predicate = () => true) => render().find(node => node.type === type && predicate(node.props));
const button = text => find("Button", props => props.children === text);
const settle = async () => {
    await new Promise(resolve => setImmediate(resolve));
};
async function reset() {
    for (const slot of slots) slot?.cleanup?.();
    slots = [];
    effects = [];
    deletes = [];
    starts = [];
    confirmResult = "confirm";
    failPreparation = false;
    pendingSubmission = false;
    projects = [{ project_id: "p1", metadata: {} }, { project_id: "p2", metadata: {} }];
    const child = { id: "child", kind: "run", project_id: "p1", status: "completed", options };
    batch = { id: "batch", kind: "batch", status: "completed", children: [child.id], runs: [child], options };
    history = [batch, child];
    render();
    await settle();
    find("Tabs").props.onChange("batch");
    await settle();
    find("BatchProjectPicker").props.onToggle("p1");
}
async function openBatch() {
    find("TimingResultRow", props => props.run.kind === "batch").props.onOpen();
    await settle();
}
await reset();
await openBatch();
button(lang.timingV2.newBatch).props.onClick();
assert.equal(find("BatchProjectPicker").props.selectedIds.size, 0);
assert.equal(find("TimingProgress"), undefined);
assert.equal(deletes.length, 0);
assert.equal(history.length, 2);
await openBatch();
confirmResult = "cancel";
button(lang.timingV2.deleteBatch).props.onClick();
await settle();
assert.equal(deletes.length, 0);
confirmResult = "confirm";
find("TimingResultRow", props => props.run.kind === "run").props.onDelete();
await settle();
assert.deepEqual(deletes, [["child", "run"]]);
assert.equal(find("TimingProgress"), undefined);
assert.equal(find("TimingResultRow"), undefined);

await reset();
await openBatch();
button(lang.timingV2.deleteBatch).props.onClick();
await settle();
assert.deepEqual(deletes, [["batch", "batch"]]);
assert.equal(find("TimingResultRow"), undefined);

await reset();
projects = [projects[1]];
target.dispatchEvent(new Event("projects-changed"));
await settle();
assert.equal(find("BatchProjectPicker").props.selectedIds.size, 0);
assert.equal(button(lang.timingV2.start).props.disabled, true);

await reset();
projects = [projects[1]];
button(lang.timingV2.start).props.onClick();
await settle();
assert.equal(starts.length, 0);
assert.equal(find("BatchProjectPicker").props.selectedIds.size, 0);

await reset();
await openBatch();
pendingSubmission = true;
button(lang.timingV2.start).props.onClick();
await settle();
assert.equal(find("TimingProgress"), undefined, "old completion card must be replaced");
assert.equal(find("TimingStartupProgress").props.stage, lang.modelSetup.checkingEnvironment);
preparationState({ status: "preparing" });
assert.equal(find("TimingStartupProgress").props.stage, lang.modelSetup.preparingEnvironment);
assert.equal(button(lang.timingV2.newBatch).props.disabled, true);
resolvePreparation();
await settle();
assert.equal(find("TimingStartupProgress").props.stage, lang.timingV2.submitting);
assert.deepEqual(starts, [["p1"]]);
resolveSubmission();
await settle();
assert.equal(find("TimingStartupProgress"), undefined);
assert.equal(button(lang.timingV2.newBatch).props.disabled, true, "active batch cannot be reset");

await reset();
button(lang.timingV2.start).props.onClick();
await settle();
button(lang.timingV2.cancel).props.onClick();
resolvePreparation();
await settle();
assert.equal(starts.length, 0);
assert.equal(find("TimingStartupProgress"), undefined);

await reset();
failPreparation = true;
button(lang.timingV2.start).props.onClick();
await settle();
resolvePreparation();
await settle();
assert.equal(find("TimingStartupProgress").props.failed, true);
assert.equal(find("TimingStartupProgress").props.error, "Preparation failed");
failPreparation = false;
button(lang.timingV2.repair).props.onClick();
await settle();
resolvePreparation();
await settle();
assert.equal(find("TimingStartupProgress"), undefined);
assert.equal(starts.length, 0, "repair must not automatically start alignment");
for (const slot of slots) slot?.cleanup?.();
console.log(
    "Batch panel: reset, reopen, deletion/cancel, last-child sync, project changes, preparation, submission and repair passed.",
);
