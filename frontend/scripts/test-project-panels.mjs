import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const lang = JSON.parse(await readFile(new URL("../src/languages/en-US.json", import.meta.url), "utf8"));
const jsx = (type, props) => ({ type, props });
const tick = () => new Promise(resolve => setImmediate(resolve));
function nodes(tree, output = []) {
    if (Array.isArray(tree)) tree.forEach(child => nodes(child, output));
    else if (tree && typeof tree === "object") {
        output.push(tree);
        nodes(tree.props?.children, output);
    }
    return output;
}
function harness() {
    const slots = [], effects = [], refresh = [];
    let cursor = 0;
    const react = {
        useState(value) {
            const i = cursor++;
            if (!(i in slots)) slots[i] = typeof value === "function" ? value() : value;
            return [slots[i], value => {
                slots[i] = typeof value === "function" ? value(slots[i]) : value;
            }];
        },
        useRef(value) {
            return slots[cursor++] ??= { current: value };
        },
        useEffect(fn, deps) {
            const i = cursor++, old = slots[i];
            if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) {
                old?.cleanup?.();
                slots[i] = { deps };
                effects.push(() => {
                    slots[i].cleanup = fn();
                });
            }
        },
        useCallback: fn => fn,
        useMemo: fn => fn(),
        useContext: () => ({ lang }),
    };
    return {
        react,
        refresh,
        render(fn) {
            cursor = 0;
            const value = fn();
            effects.splice(0).forEach(fn => fn());
            return value;
        },
        settingsHook(fn) {
            react.useEffect(() => {
                refresh.push(fn);
                void fn();
            }, []);
        },
        cleanup() {
            slots.forEach(slot => slot?.cleanup?.());
        },
    };
}
async function load(path, imports) {
    const source = await readFile(new URL("../src/" + path, import.meta.url), "utf8");
    const code = ts.transpileModule(source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
            jsx: ts.JsxEmit.ReactJSX,
        },
    }).outputText;
    const exports = {};
    new Function("require", "exports", code)(
        name => name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : imports(name),
        exports,
    );
    return exports;
}
const fallback = () => new Proxy({}, { get: (_, name) => name });
let autoFill = true;
async function setup(h, overrides = {}) {
    const deps = name => {
        if (name === "react") return h.react;
        if (name.includes("useSettingsUpdated")) return { useSettingsUpdated: fn => h.settingsHook(fn) };
        if (name.includes("api/settings")) {
            return {
                settings: async () => ({
                    auto_fill_lyrics_library_from_project_metadata: autoFill,
                    upload_derive_plain_from_synced: true,
                }),
            };
        }
        if (name.includes("useMessage")) {
            return {
                useMessage: () => {
                    const [message, set] = h.react.useState("");
                    return [message, set, () => set(""), false, "info", 0];
                },
            };
        }
        if (name.includes("shared/format")) return { formatDuration: String };
        if (name.includes("api/request")) return { backendMessageText: String };
        if (name.includes("ui/Toast")) return { toastPubSub: { pub() {} } };
        return overrides[name] || fallback();
    };
    const scope = await load("features/shared/useRequestScope.ts", deps);
    const seed = await load("features/shared/useProjectMetadataSeed.ts", deps);
    return name =>
        name.includes("useRequestScope") ? scope : name.includes("useProjectMetadataSeed") ? seed : deps(name);
}
const meta = (name) => ({ track: name, artist: "Singer " + name, album: "Album", duration: 10 });
const h = harness(), deps = await setup(h);
const { useProjectMetadataSeed } = await load("features/shared/useProjectMetadataSeed.ts", deps);
let args = { panelSessionId: "draft-A", project: null, fallbackMeta: meta("A") }, seeded;
const renderSeed = () => h.render(() => seeded = useProjectMetadataSeed(args));
async function settle(render) {
    for (let i = 0; i < 3; i++) {
        render();
        await tick();
    }
    return render();
}
await settle(renderSeed);
assert.equal(seeded.meta.track, "A");
seeded.updateQuery("");
seeded.updateMeta("artist", "Manual singer");
args = { ...args, project: { project_id: "saved-A" }, fallbackMeta: meta("B") };
await settle(renderSeed);
assert.equal(seeded.meta.track, "B");
assert.equal(seeded.meta.artist, "Manual singer");
assert.equal(seeded.query, "");
args = { ...args, panelSessionId: "draft-B" };
await settle(renderSeed);
assert.equal(seeded.query, "Singer B B");
assert.equal(seeded.meta.artist, "Singer B");
autoFill = false;
await h.refresh[0]();
await settle(renderSeed);
assert.equal(seeded.query, "");
assert.equal(seeded.meta.track, "");
seeded.updateQuery("Keep manual");
args = { ...args, fallbackMeta: meta("C") };
await settle(renderSeed);
assert.equal(seeded.query, "Keep manual");
args = { ...args, panelSessionId: "draft-C" };
await settle(renderSeed);
assert.equal(seeded.query, "");
h.cleanup();
autoFill = true;

const scopeHarness = harness();
const { useRequestScope } = await load(
    "features/shared/useRequestScope.ts",
    name => name === "react" ? scopeHarness.react : fallback(),
);
let key = "A", scope;
const renderScope = () => scopeHarness.render(() => scope = useRequestScope(key));
renderScope();
const oldScope = scope;
const a = scope.begin(), b = scope.begin();
assert.equal(a(), false);
assert.equal(b(), true);
key = "B";
renderScope();
key = "A";
renderScope();
assert.equal(b(), false);
assert.equal(oldScope.begin()(), false, "old rendered callbacks stay invalid after A → B → A");
const alive = scope.begin();
scopeHarness.cleanup();
assert.equal(alive(), false);

const nh = harness();
let pending = [], payloads = [], messages = [];
const nd = await setup(nh, {
    "../../shared/api/lyricsSources.js": {
        neteaseSearch: input => {
            payloads.push(input);
            return new Promise(resolve => pending.push(resolve));
        },
    },
});
const { NeteaseSearch } = await load("features/shared/NeteaseSearch.tsx", nd);
let np = {
    panelSessionId: "A",
    workspaceId: "audio-A",
    defaultQuery: "",
    meta: meta("A"),
    onMessage: text => messages.push(text),
    renderResultActions: ({ isCurrent }) => jsx("Action", { isCurrent }),
};
const renderNetease = () => nh.render(() => NeteaseSearch(np));
const searchInput = () => nodes(renderNetease()).filter(node => node.type === "input")[1];
const search = () =>
    nodes(renderNetease()).find(node => node.type === "button" && node.props.children === lang.ui.search).props
        .onClick();
await settle(renderNetease);
assert.equal(searchInput().props.value, "A Singer A");
const old = search();
np = { ...np, meta: meta("B"), workspaceId: "audio-B" };
await settle(renderNetease);
pending.shift()({ results: [{ id: 1, label: "Old result" }] });
await old;
assert.equal(nodes(renderNetease()).some(node => node.props?.children === "Old result"), false);
assert.equal(searchInput().props.value, "B Singer B");
searchInput().props.onChange({ target: { value: "Manual" } });
renderNetease();
np = { ...np, meta: meta("C") };
await settle(renderNetease);
assert.equal(searchInput().props.value, "Manual");
const currentSearch = search();
pending.shift()({ results: [{ id: 2, label: "Current" }] });
await currentSearch;
const action = nodes(renderNetease()).find(node => node.type === "Action");
assert.equal(action.props.isCurrent(), true);
np = { ...np, workspaceId: "audio-D" };
renderNetease();
assert.equal(action.props.isCurrent(), false);
nh.cleanup();

const uh = harness();
let planResponses = [], uploadCalls = 0;
const ud = await setup(uh, {
    "../../shared/api/upload.js": {
        uploadPlan: () => new Promise(resolve => planResponses.push(resolve)),
        uploadRun: async () => {
            uploadCalls++;
            return { message: "done" };
        },
    },
});
const { UploadPanel } = await load("features/upload/UploadPanel.tsx", ud);
let up = {
    panelSessionId: "A",
    workspaceId: "audio-A",
    project: { project_id: "A", metadata: meta("A") },
    plainLyrics: "A",
    syncedLyrics: "",
    editorMeta: meta("A"),
    onSave: async () => up.project,
};
const renderUpload = () => uh.render(() => UploadPanel(up));
const button = text => nodes(renderUpload()).find(node => node.type === "button" && node.props.children === text);
const plan = { can_upload: true, mode: "auto", warnings: [], payload_preview: {}, plain_lines: 1, synced_lines: 0 };
await settle(renderUpload);
const generating = button(lang.ui.generatePlan).props.onClick();
await tick();
up = { ...up, plainLyrics: "B" };
renderUpload();
planResponses.shift()(plan);
await generating;
assert.equal(button(lang.ui.confirmUpload).props.disabled, true);
const fresh = button(lang.ui.generatePlan).props.onClick();
await tick();
planResponses.shift()(plan);
await fresh;
const staleButton = button(lang.ui.confirmUpload);
assert.equal(staleButton.props.disabled, false);
up = { ...up, editorMeta: meta("B") };
renderUpload();
assert.equal(button(lang.ui.confirmUpload).props.disabled, true);
// The old callback must not submit after inputs have changed, even before effect cleanup.
await staleButton.props.onClick();
assert.equal(uploadCalls, 0);
for (
    const mutate of [
        () => {
            up = { ...up, workspaceId: "new-audio" };
        },
        () => {
            up = { ...up, syncedLyrics: "[00:01.00]changed" };
        },
        () => nodes(renderUpload()).find(node => node.type === "select").props.onChange({ target: { value: "plain" } }),
        () => {
            up = { ...up, panelSessionId: "another-draft", project: { ...up.project, project_id: "B" } };
        },
    ]
) {
    const producing = button(lang.ui.generatePlan).props.onClick();
    await tick();
    planResponses.shift()(plan);
    await producing;
    assert.equal(button(lang.ui.confirmUpload).props.disabled, false);
    mutate();
    renderUpload();
    assert.equal(button(lang.ui.confirmUpload).props.disabled, true);
}
const finalPlan = button(lang.ui.generatePlan).props.onClick();
await tick();
planResponses.shift()(plan);
await finalPlan;
await button(lang.ui.confirmUpload).props.onClick();
assert.equal(uploadCalls, 1);
uh.cleanup();

const eligibility = await load(
    "features/roller/retryEligibility.ts",
    name =>
        name.includes("timingV2")
            ? { isRunActive: run => ["queued", "running", "cancelling"].includes(run.status) }
            : fallback(),
);
const options = { language: "auto", audio_mode: "mix" },
    current = { projectId: "A", workspaceId: "audio-A", signature: "lyrics-A", options };
const run = {
    kind: "run",
    status: "completed",
    project_id: "A",
    workspace_id: "audio-A",
    lyrics_version: "lyrics-A",
    audio_identity: "digest",
    lyrics_hash: "hash",
    options,
};
assert.equal(eligibility.canRetryTiming(run, current), true);
for (
    const change of [{ projectId: undefined }, { projectId: "B" }, { workspaceId: "audio-B" }, {
        signature: "lyrics-B",
    }, { options: { ...options, language: "zh" } }]
) assert.equal(eligibility.canRetryTiming(run, { ...current, ...change }), false);
assert.equal(eligibility.canRetryTiming({ ...run, lyrics_hash: undefined }, current), false);
assert.equal(eligibility.canRetryTiming({ ...run, status: "running" }, current), false);
console.log(
    "Project panel sessions: automatic/manual seeds, first save, replacement audio, disabled autofill, stale results, publishing invalidation and retry eligibility passed.",
);
