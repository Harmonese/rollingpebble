import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/features/settings/sections/EngineModels.tsx", import.meta.url), "utf8");
const lang = JSON.parse(await readFile(new URL("../src/languages/en-US.json", import.meta.url), "utf8"));
const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const slots = [], effects = [], calls = [];
let cursor = 0, refresh, queryFails = false;
let report = {
    models: ["whisper", "ctc", "demucs", "ctc-zh", "ctc-mul"].map(kind => ({
        kind,
        status: "missing",
        total_bytes: 100,
    })),
    external_models: [{ kind: "whisper", path: "/external", status: "unverified" }],
    startup_issues: [],
    job: { status: "running", progress: { stage: "checking_external", detail: { kind: "whisper" } } },
};
const react = {
    useContext: () => ({ lang }),
    useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], value => {
            slots[index] = value;
        }];
    },
    useRef(value) {
        return slots[cursor++] ??= { current: value };
    },
    useEffect(fn) {
        const index = cursor++;
        if (!slots[index]) {
            slots[index] = true;
            effects.push(fn);
        }
    },
};
const jsx = (type, props) => ({ type, props });
const exports = {};
new Function("require", "exports", "setTimeout", "clearTimeout", compiled)(
    name => {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name.includes("api/models")) {
            return {
                cachedModels: () => report,
                getModels: async () => {
                    if (queryFails) throw new Error("temporary query");
                    return report;
                },
                modelJobActive: job => job?.status === "running",
                modelName: name => name,
                manageModels: async (...args) => calls.push(args),
            };
        }
        if (name.includes("api/settings")) return { settings: async () => ({}), updateSettings: async () => {} };
        if (name.includes("api/request")) return { backendMessageText: value => String(value) };
        if (name.includes("ModelDownloadFields")) {
            return { modelNetwork: value => value, ModelDownloadFields: "Fields" };
        }
        if (name.includes("ConfirmDialog")) return { useConfirmDialog: () => async () => "confirm" };
        if (name.includes("ui/index")) {
            return {
                Button: "Button",
                ActionRow: "Row",
                StatusPill: "Status",
                MessageText: "Message",
            };
        }
        if (name.includes("format")) return { formatBytes: String };
        return {};
    },
    exports,
    fn => {
        refresh = fn;
        return 1;
    },
    () => {},
);
function render() {
    cursor = 0;
    const tree = exports.EngineModels({ ready: true });
    effects.splice(0).forEach(fn => fn());
    return tree;
}
function findAll(tree, type) {
    if (Array.isArray(tree)) return tree.flatMap(child => findAll(child, type));
    if (!tree?.props) return [];
    return [...(tree.type === type ? [tree] : []), ...findAll(tree.props.children, type)];
}
const settle = () => new Promise(resolve => setImmediate(resolve));
render();
await settle();
assert.equal(findAll(render(), "progress").length, 0, "external checks never show managed byte counters");
assert.ok(findAll(render(), "Status").some(item => item.props.children === lang.modelSetup.checkingExternal));
report = {
    ...report,
    job: {
        status: "running",
        progress: {
            stage: "verifying_download",
            detail: { kind: "ctc" },
            bytes_downloaded: 25,
            bytes_total: 100,
        },
    },
};
refresh();
await settle();
assert.deepEqual(findAll(render(), "progress").map(item => item.props.value), [25]);
assert.ok(findAll(render(), "Status").some(item => item.props.children === lang.modelSetup.verifyingDownload));
queryFails = true;
refresh();
await settle();
assert.equal(findAll(render(), "Message").length, 1);
queryFails = false;
report = { ...report, job: { status: "failed", error_message: "real task failure" } };
refresh();
await settle();
assert.deepEqual(findAll(render(), "Message").map(item => item.props.children), ["real task failure"]);
const external = findAll(render(), "Row").find(item => item.props.description === "/external");
findAll(external, "Button")[0].props.onClick();
await settle();
assert.deepEqual(calls, [["verify", undefined, true]], "external checks use the shared startup inventory");
console.log("Model settings: phase progress, external isolation, query recovery and external recheck passed.");
