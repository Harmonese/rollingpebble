import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/app/StartupGate.tsx", import.meta.url), "utf8");
const lang = JSON.parse(await readFile(new URL("../src/languages/en-US.json", import.meta.url), "utf8"));
const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
let slots, cursor, effects, cleanups, runtime, calls, resolveReady, rejectReady, modelCalls;
const react = {
    useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], value => {
            slots[index] = typeof value === "function" ? value(slots[index]) : value;
        }];
    },
    useRef(value) {
        return slots[cursor++] ??= { current: value };
    },
    useContext() {
        return { lang };
    },
    useEffect(fn, deps) {
        const index = cursor++, previous = slots[index];
        if (!previous || deps.some((value, i) => value !== previous[i])) {
            cleanups[index]?.();
            effects.push(() => {
                cleanups[index] = fn();
            });
            slots[index] = deps;
        }
    },
};
const jsx = (type, props) => ({ type, props });
const exports = {};
new Function("require", "exports", compiled)(name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name.includes("autoTiming")) return { autoRollerRuntime: async () => runtime };
    if (name.includes("runtimePreparation")) {
        return {
            waitForRuntime: (vocals, current, repair) => {
                calls.push({ vocals, repair });
                return new Promise((resolve, reject) => {
                    resolveReady = () => resolve(current());
                    rejectReady = reject;
                });
            },
        };
    }
    if (name.includes("api/models")) {
        return {
            manageModels: async () => {
                modelCalls++;
                return { job_id: "check", status: "succeeded" };
            },
            waitForModels: async job => job,
            getModels: async () => ({ models: [], startup_issues: [] }),
        };
    }
    if (name.includes("api/settings")) return { settings: async () => ({}) };
    if (name.includes("ModelDownloadFields")) return { modelNetwork: value => value };
    if (name.includes("api/request")) return { backendMessageText: e => String(e) };
    if (name.includes("ui/index")) return { Button: "Button" };
    return {};
}, exports);
function reset(bundled = true) {
    slots = [];
    cursor = 0;
    effects = [];
    cleanups = [];
    calls = [];
    modelCalls = 0;
    runtime = { startup_preparation: bundled, settings: { auto_timing_v2_options: { audio_mode: "vocals" } } };
}
function render() {
    cursor = 0;
    const tree = exports.StartupGate({ children: "workspace" });
    effects.splice(0).forEach(fn => fn());
    return tree;
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function find(tree, label) {
    if (Array.isArray(tree)) return tree.map(item => find(item, label)).find(Boolean);
    if (tree?.type === "Button" && tree.props.children === label) return tree;
    if (tree?.props) return find(tree.props.children, label);
}

reset();
assert.equal(render().type, "main");
await settle();
assert.deepEqual(calls, [{ vocals: true, repair: false }]);
assert.equal(render().type, "main", "workspace must wait for readiness");
resolveReady();
await settle();
assert.equal(render().props.children, "workspace");
assert.equal(modelCalls, 1, "model check follows runtime readiness");

reset(false);
render();
await settle();
assert.equal(calls.length, 0, "unbundled WebUI must remain usable without engine resources");
assert.equal(render().props.children, "workspace");

reset();
render();
await settle();
rejectReady(new Error("failed"));
await settle();
find(render(), "Repair").props.onClick();
render();
await settle();
assert.deepEqual(calls[1], { vocals: true, repair: true });
rejectReady(new Error("failed again"));
await settle();
find(render(), lang.timingV2.continueApp).props.onClick();
assert.equal(render().props.children, "workspace");
assert.equal(modelCalls, 0, "continuing after runtime failure bypasses model checks");

reset();
render();
await settle();
cleanups.forEach(fn => fn?.());
resolveReady();
await settle();
assert.equal(render().type, "main", "an abandoned check must not open the workspace");
console.log("Startup: readiness gate, saved Vocals capability, WebUI fallback, repair, continue and cleanup passed.");
