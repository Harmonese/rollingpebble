import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/app/StartupGate.tsx", import.meta.url), "utf8");
const lang = JSON.parse(await readFile(new URL("../src/languages/en-US.json", import.meta.url), "utf8"));
const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
let slots,
    cursor,
    effects,
    cleanups,
    report,
    operations,
    writes,
    failSave,
    pendingDownload,
    pendingCheck,
    releaseCancel;
let bundled, pollFailure, cancelFailure;
const react = {
    useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
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
    if (name.includes("api/autoTiming")) {
        return { autoRollerRuntime: async () => ({ startup_preparation: bundled, settings: {} }) };
    }
    if (name.includes("runtimePreparation")) return { waitForRuntime: async () => true };
    if (name.includes("ModelDownloadFields")) {
        return {
            ModelDownloadFields: "Fields",
            modelNetwork: value => value,
        };
    }
    if (name.includes("api/models")) {
        return {
            modelJobActive: job => job?.status === "running",
            getModels: async () => report,
            manageModels: async (action, kinds, startup) => {
                operations.push({ action, kinds, startup });
                return { job_id: action, status: "running" };
            },
            waitForModels: async (job, current, progress) => {
                progress(job);
                if (pollFailure) throw new Error("query failed");
                if ((job.job_id === "download" && pendingDownload) || (job.job_id === "verify" && pendingCheck)) {
                    return new Promise(() => {});
                }
                if (job.job_id === "download") report.startup_issues = [];
                return current() ? { ...job, status: "succeeded" } : null;
            },
            cancelModels: async () => {
                if (cancelFailure) throw new Error("cancel query failed");
                return new Promise(resolve => {
                    releaseCancel = resolve;
                });
            },
            modelName: value => value,
        };
    }
    if (name.includes("api/settings")) {
        return {
            settings: async () => ({ model_download_source: "modelscope", model_proxy_enabled: false }),
            updateSettings: async value => {
                if (failSave) throw new Error("settings failed");
                writes.push(value);
            },
        };
    }
    if (name.includes("api/request")) return { backendMessageText: e => String(e) };
    if (name.includes("format")) return { formatBytes: value => String(value) };
    if (name.includes("ui/index")) {
        return { Button: "Button", Modal: "Modal", MessageText: "Message", DialogActionRow: "Actions" };
    }
    return {};
}, exports);
function reset({ upgrade = false, broken = false } = {}) {
    cleanups?.forEach(fn => fn?.());
    slots = [];
    cursor = 0;
    effects = [];
    cleanups = [];
    operations = [];
    writes = [];
    failSave = false;
    pendingDownload = false;
    pendingCheck = false;
    bundled = true;
    pollFailure = false;
    cancelFailure = false;
    report = {
        onboarding_complete: upgrade,
        models: ["whisper", "ctc", "demucs"].map(kind => ({
            kind,
            status: broken ? kind === "demucs" ? "corrupt" : "ready" : "missing",
            repair_needed: broken && kind === "demucs",
            download_bytes: 100,
        })),
    };
    report.external_models = [];
    report.startup_issues = report.models.filter(model => model.status !== "ready").map(model => ({
        kind: model.kind,
        origin: "managed",
        status: model.status,
        reason: model.status,
        action: model.status === "corrupt" ? "repair" : "download",
    }));
}
function render() {
    cursor = 0;
    const tree = exports.StartupGate({ children: "workspace" });
    effects.splice(0).forEach(fn => fn());
    return tree;
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function find(tree, type, label) {
    if (Array.isArray(tree)) return tree.map(item => find(item, type, label)).find(Boolean);
    if (tree?.type === "Modal" && !tree.props.open) return;
    if (tree?.type === type && (label === undefined || tree.props.children === label)) return tree;
    if (tree?.props) return find(tree.props.children, type, label);
}
async function click(label) {
    const button = find(render(), "Button", label);
    assert.ok(button, label);
    assert.ok(!button.props.disabled, label + " should be enabled");
    button.props.onClick();
    await settle();
}

reset();
render();
await settle();
assert.equal(operations[0].action, "verify");
assert.ok(find(render(), "Modal"));
await click(lang.timingV2.download);
assert.equal(find(render(), "Fields").props.value.model_download_source, "modelscope");
assert.equal(find(render(), "Fields").props.value.model_proxy_enabled, false);
await click(lang.timingV2.download);
assert.deepEqual(operations[1].kinds, ["whisper", "ctc", "demucs"]);
assert.equal(render().props.children, "workspace");
assert.ok(writes[0].model_onboarding_complete);

reset();
render();
await settle();
await click(lang.modelSetup.later);
assert.equal(render().props.children, "workspace");
assert.equal(operations.length, 1, "Later never downloads");

reset();
render();
await settle();
find(render(), "Modal").props.onClose();
await settle();
assert.equal(render().props.children, "workspace");
assert.ok(writes[0].model_onboarding_complete, "closing records the onboarding choice");

reset({ upgrade: true });
render();
await settle();
assert.ok(find(render(), "Modal"), "upgrades also prompt for absent models");
await click(lang.modelSetup.later);
assert.equal(render().props.children, "workspace");

reset({ upgrade: true, broken: true });
render();
await settle();
await click(lang.modelSetup.repair);
await click(lang.timingV2.download);
assert.deepEqual(operations[1].kinds, ["demucs"], "repair only targets affected models");

reset();
render();
await settle();
await click(lang.timingV2.download);
failSave = true;
await click(lang.timingV2.download);
assert.equal(operations.length, 1, "failed settings save must not start a download");
assert.ok(find(render(), "Message"));
await click(lang.modelSetup.later);
assert.ok(find(render(), "Modal"), "failed onboarding persistence stays reviewable");

reset();
render();
await settle();
await click(lang.timingV2.download);
pendingDownload = true;
await click(lang.timingV2.download);
await click(lang.ui.cancel);
assert.notEqual(render().props.children, "workspace", "cancel waits for the worker to exit");
releaseCancel();
await settle();
assert.equal(render().props.children, "workspace");

reset({ upgrade: true });
pendingCheck = true;
render();
await settle();
await click(lang.modelSetup.skip);
assert.notEqual(render().props.children, "workspace");
releaseCancel();
await settle();
assert.equal(render().props.children, "workspace");

reset();
bundled = false;
render();
await settle();
assert.equal(render().props.children, "workspace");
assert.equal(operations.length, 0);

reset();
pollFailure = true;
render();
await settle();
assert.ok(find(render(), "Message"));
assert.ok(!find(render(), "Button", lang.timingV2.continueApp), "lost query cannot abandon a potentially active task");
pollFailure = false;
await click(lang.modelSetup.retry);
assert.ok(find(render(), "Modal"));
assert.ok(!find(render(), "Message"), "query recovery clears transient error");
assert.equal(operations.length, 1, "poll retry observes the original task");

reset();
pendingCheck = true;
render();
await settle();
cancelFailure = true;
await click(lang.modelSetup.skip);
assert.notEqual(render().props.children, "workspace");
assert.ok(!find(render(), "Button", lang.timingV2.continueApp));
cancelFailure = false;
await click(lang.modelSetup.skip);
releaseCancel();
await settle();
assert.equal(render().props.children, "workspace");
console.log(
    "Model setup: missing reminders, targeted repair, save failure, query recovery and cancel/skip waiting passed.",
);
