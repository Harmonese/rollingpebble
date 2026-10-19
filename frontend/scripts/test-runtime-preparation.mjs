import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/shared/api/runtimePreparation.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
let responses = [], requests = [], afterDelay = () => {};
class BackendApiError extends Error {}
const exports = {};
new Function("require", "exports", "setTimeout", compiled)(
    () => ({
        BackendApiError,
        request: async (_url, init) => {
            requests.push(JSON.parse(init.body));
            const response = responses.shift();
            assert.ok(response, "unexpected additional preparation request");
            return response;
        },
    }),
    exports,
    callback => {
        afterDelay();
        callback();
    },
);
const preparing = { status: "preparing", capabilities: [], job_id: "one" };
const ready = { status: "ready", capabilities: ["original", "vocals"], job_id: "one" };

responses = [preparing, ready];
assert.equal(await exports.waitForRuntime(false, () => true), true);
assert.deepEqual(requests, [{ capability: "original", repair: false }, { capability: "original", repair: false }]);

for (const reason of ["cancel", "lyrics", "audio", "project", "options", "batch-selection"]) {
    let current = "initial";
    afterDelay = () => {
        current = reason;
    };
    responses = [preparing];
    requests = [];
    assert.equal(await exports.waitForRuntime(false, () => current === "initial"), false);
    assert.equal(requests.length, 1, "cancelled/changed intent must not continue polling or start inference");
}

afterDelay = () => {};
responses = [{ status: "failed", capabilities: [] }];
await assert.rejects(exports.waitForRuntime(false, () => true), BackendApiError);
responses = [preparing, ready];
requests = [];
assert.equal(await exports.waitForRuntime(true, () => true, true), true);
assert.deepEqual(requests, [{ capability: "vocals", repair: true }, { capability: "vocals", repair: false }]);

responses = [ready];
assert.equal(await exports.waitForRuntime(false, () => false), false);
console.log("Runtime preparation: readiness, cancellation, identity changes, failure and one-shot repair passed.");

// Exercise the actual panel callbacks without a browser or application data.
const panelSource = await readFile(new URL("../src/features/roller/RollerPanel.tsx", import.meta.url), "utf8");
const panelCode = ts.transpileModule(panelSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
let slots, cursor, resolvePreparation, preparationCalls, saves, starts;
const options = { audio_mode: "mix" };
const language = { ui: {}, timingV2: { start: "Start", cancel: "Cancel" }, backendMessages: {} };
const react = {
    useState(value) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = value;
        return [slots[index], next => {
            slots[index] = typeof next === "function" ? next(slots[index]) : next;
        }];
    },
    useRef(value) {
        return slots[cursor++] ??= { current: value };
    },
    useEffect() {},
    useContext() {
        return { lang: language };
    },
};
const jsx = (type, props) => ({ type, props });
const panelExports = {};
new Function("require", "exports", panelCode)(name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name.includes("useAutoTimingState")) return { useAutoTimingState: () => ({ options }) };
    if (name.includes("useSettingsUpdated")) return { useSettingsUpdated() {} };
    if (name.includes("runtimePreparation")) {
        return {
            waitForRuntime: async (_vocals, current) => {
                preparationCalls++;
                await new Promise(resolve => {
                    resolvePreparation = resolve;
                });
                return current();
            },
        };
    }
    if (name.includes("timingV2")) {
        return {
            isRunActive: () => false,
            startTiming: async () => {
                starts++;
                return { id: "run", status: "queued" };
            },
        };
    }
    if (name.includes("request")) return { BackendApiError, backendMessageText: String };
    if (name.includes("ConfirmDialog")) return { useConfirmDialog: () => async () => "confirm" };
    if (name.includes("ui/index")) return { Button: "Button", Panel: "Panel", StatusPill: "StatusPill", Tabs: "Tabs" };
    return {};
}, panelExports);
function buttons(tree, output = []) {
    if (Array.isArray(tree)) tree.forEach(item => buttons(item, output));
    else if (tree && typeof tree === "object") {
        if (tree.type === "Button") output.push(tree);
        buttons(tree.props?.children, output);
    }
    return output;
}
for (const scenario of ["start", "cancel", "workspace-change"]) {
    slots = [];
    cursor = 0;
    preparationCalls = 0;
    saves = 0;
    starts = 0;
    const props = {
        project: null,
        workspaceId: "workspace",
        workspaceSignature: "original",
        workspaceBusy: false,
        canStart: true,
        onRun() {},
        saveWorkspace: async () => {
            saves++;
            return { project_id: "project", plain_lyrics: "lyrics" };
        },
    };
    const render = () => {
        cursor = 0;
        return buttons(panelExports.RollerPanel(props));
    };
    const initial = render();
    initial.find(button => button.props.tone === "primary").props.onClick();
    initial.find(button => button.props.tone === "primary").props.onClick();
    assert.equal(preparationCalls, 1, "double-click must not create another start intent");
    assert.equal(saves, 0, "preparation must precede project saving");
    if (scenario === "cancel") render().find(button => button.props.children === "Cancel").props.onClick();
    if (scenario === "workspace-change") {
        props.workspaceSignature = "changed";
        render();
    }
    resolvePreparation();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saves, scenario === "start" ? 1 : 0);
    assert.equal(starts, scenario === "start" ? 1 : 0);
}
console.log("Start panel: duplicate clicks, preparation-before-save, cancellation and workspace-change guards passed.");
