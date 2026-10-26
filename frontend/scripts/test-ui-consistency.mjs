import { transform } from "lightningcss";
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
async function moduleAt(path, imports = {}, globals = {}) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    const code = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports = {};
    new Function("require", "exports", ...Object.keys(globals), code)(
        name => {
            if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
            return imports[name] || new Proxy({}, { get: (_target, key) => key });
        },
        exports,
        ...Object.values(globals),
    );
    return exports;
}
function hooks() {
    let cursor = 0;
    const slots = [], effects = [];
    return {
        api: {
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
            useContext: () => ({ lang, prefState: { lang: "en-US" } }),
            useEffect(callback, deps) {
                const index = cursor++, previous = slots[index];
                if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
                    previous?.cleanup?.();
                    slots[index] = { deps };
                    effects.push(() => {
                        slots[index].cleanup = callback();
                    });
                }
            },
            useLayoutEffect() {},
            useMemo: callback => callback(),
            useCallback: callback => callback,
        },
        render(fn) {
            cursor = 0;
            const tree = fn();
            effects.splice(0).forEach(effect => effect());
            return tree;
        },
        cleanup() {
            slots.forEach(slot => slot?.cleanup?.());
        },
    };
}

const { TaskStatus } = await moduleAt("../src/ui/TaskStatus.tsx");
const progress = tree => nodes(tree).find(node => node.props?.role === "progressbar");
assert.equal(progress(TaskStatus({ title: "Preparing" })).props["aria-valuenow"], undefined);
assert.ok(progress(TaskStatus({ title: "Preparing" })).props.className.includes("indeterminate"));
assert.equal(progress(TaskStatus({ title: "Aligning", fraction: 0.4 })).props["aria-valuenow"], 40);
assert.equal(progress(TaskStatus({ title: "Aligning", fraction: 4 })).props["aria-valuenow"], 100);
const failed = TaskStatus({ title: "Failed", active: false, error: "Disconnected", children: "Retry" });
assert.equal(progress(failed), undefined);
assert.equal(nodes(failed).find(node => node.type === "MessageText").props.role, "alert");
assert.ok(nodes(failed).some(node => node.props?.children === "Retry"));

// Environment checks keep one card across checking, preparation and failed repair.
const runtimeHooks = hooks();
const timers = [], ensureCalls = [], readiness = [];
let response = { status: "checking" };
const { RuntimePreparation } = await moduleAt("../src/features/settings/sections/RuntimePreparation.tsx", {
    react: runtimeHooks.api,
    "../../../shared/api/runtimePreparation.js": {
        cachedPreparation: () => null,
        ensureRuntime: async (...args) => {
            ensureCalls.push(args);
            return response;
        },
    },
    "../../../shared/api/request.js": { BackendApiError: class extends Error {}, backendMessageText: String },
}, {
    setTimeout: callback => {
        timers.push(callback);
        return 0;
    },
    clearTimeout() {},
});
const renderRuntime = () =>
    runtimeHooks.render(() => RuntimePreparation({ lang, vocals: false, onReady: value => readiness.push(value) }));
renderRuntime();
await tick();
assert.equal(renderRuntime().props.title, lang.modelSetup.checkingEnvironment);
response = { status: "preparing" };
timers.shift()();
await tick();
assert.equal(renderRuntime().props.title, lang.modelSetup.preparingEnvironment);
response = { status: "failed", error: "broken" };
timers.shift()();
await tick();
assert.equal(renderRuntime().props.active, false);
assert.equal(renderRuntime().props.error, "[object Object]");
response = { status: "ready" };
nodes(renderRuntime()).find(node => node.type === "Button").props.onClick();
renderRuntime();
await tick();
assert.equal(ensureCalls.at(-1)[1], true, "repair intent must reach ensureRuntime");
assert.equal(renderRuntime(), null);
assert.equal(readiness.at(-1), true);
runtimeHooks.cleanup();

// Connection save, test, cancellation and errors keep their feedback in the task card.
const connectionHooks = hooks();
const config = {
    base_url: "http://localhost",
    model: "test",
    prompt: "",
    default_prompt: "",
    has_key: false,
    key_persistent: true,
};
let resolveSave, resolvePoll, cancelCalls = 0;
const { TranslationSettingsSection } = await moduleAt(
    "../src/features/settings/sections/TranslationSettingsSection.tsx",
    {
        react: connectionHooks.api,
        "../../../shared/api/translation.js": {
            translationConnection: async () => config,
            saveTranslationConnection: () =>
                new Promise(resolve => {
                    resolveSave = resolve;
                }),
            startTranslation: async () => ({ status: "running" }),
            getTranslation: () =>
                new Promise(resolve => {
                    resolvePoll = resolve;
                }),
            cancelTranslation: async () => {
                cancelCalls++;
                return { status: "canceled" };
            },
        },
        "../../../shared/api/request.js": { backendMessageText: error => error.code || String(error) },
    },
    {
        setTimeout: callback => {
            queueMicrotask(callback);
            return 0;
        },
    },
);
const renderConnection = () => connectionHooks.render(() => TranslationSettingsSection());
const findButton = label =>
    nodes(renderConnection()).find(node => node.type === "Button" && node.props.children === label);
const connectionCard = () => nodes(renderConnection()).find(node => node.type === "TaskStatus");
renderConnection();
await tick();
findButton(lang.translation.save).props.onClick();
assert.equal(connectionCard().props.title, lang.settings.messages.saving);
resolveSave(config);
await tick();
assert.equal(connectionCard().props.title, lang.translation.saved);
assert.equal(connectionCard().props.active, false);
findButton(lang.translation.test).props.onClick();
assert.equal(connectionCard().props.title, lang.translation.connecting);
assert.equal(findButton(lang.ui.cancel).props.disabled, true, "saving connection has no cancellable test yet");
resolveSave(config);
await tick();
assert.equal(findButton(lang.ui.cancel).props.disabled, false);
findButton(lang.ui.cancel).props.onClick();
assert.equal(connectionCard().props.title, lang.translation.cancelling);
assert.equal(findButton(lang.ui.cancel).props.disabled, true);
resolvePoll({ status: "canceled" });
await tick();
assert.equal(cancelCalls, 1);
assert.equal(connectionCard().props.title, lang.timingV2.cancelled);
assert.equal(connectionCard().props.active, false);
findButton(lang.translation.test).props.onClick();
resolveSave(config);
await tick();
resolvePoll({ status: "failed", error: "translation.network" });
await tick();
assert.equal(connectionCard().props.active, false);
assert.equal(connectionCard().props.error, "translation.network");
connectionHooks.cleanup();

const editorHooks = hooks();
const controller = {
    busy: true,
    job: { status: "running" },
    error: "",
    source: "auto",
    target: "en",
    cancel() {},
    retry() {},
};
const { TranslationEditor } = await moduleAt("../src/features/translation/TranslationEditor.tsx", {
    react: editorHooks.api,
    "../../shared/editorDraft.js": { readEditorRecovery: () => null },
    "./translation.css": {},
});
const renderEditor = () =>
    editorHooks.render(() =>
        TranslationEditor({
            state: { lyric: [{ id: "line", text: "Hello" }], selectIndex: 0, info: {}, targetLanguage: "en" },
            dispatch() {},
            controller,
        })
    );
assert.equal(nodes(renderEditor()).find(node => node.type === "TaskStatus").props.title, lang.translation.translating);
assert.equal(
    nodes(renderEditor()).find(node => node.type === "Button" && node.props.children === lang.translation.translate)
        .props.disabled,
    true,
);
controller.job.status = "cancelling";
assert.equal(
    nodes(renderEditor()).find(node => node.type === "Button" && node.props.children === lang.ui.cancel).props.disabled,
    true,
);
controller.busy = false;
controller.error = "Network error";
assert.equal(nodes(renderEditor()).find(node => node.type === "TaskStatus").props.error, "Network error");
assert.ok(nodes(renderEditor()).some(node => node.type === "Button" && node.props.children === lang.translation.retry));
editorHooks.cleanup();
console.log(
    "Shared task UI: measured/unknown progress, failure semantics, runtime repair, connection lifecycle and translation cancellation passed.",
);

// Compare parsed CSS cascade for dangerous buttons in ordinary, settings and storage contexts.
// This is a small selector evaluator; it neither starts a browser nor touches application data.
const rules = [];
for (
    const file of [
        "../src/ui/actions.css",
        "../src/features/settings/settings.css",
        "../src/ui/form.css",
        "../src/features/translation/translation.css",
    ]
) {
    transform({
        filename: file,
        code: await readFile(new URL(file, import.meta.url)),
        visitor: {
            Rule(rule) {
                if (rule.type === "style") rules.push(rule.value);
            },
        },
    });
}
const element = (classes, parent = null, states = []) => ({
    classes: classes.split(" "),
    parent,
    states,
    tag: "button",
});
function matches(selector, node) {
    if (!node) return false;
    const split = selector.findLastIndex(part => part.type === "combinator");
    const simple = selector.slice(split + 1).every(part => {
        if (part.type === "class") return node.classes.includes(part.name);
        if (part.type === "type") return part.name === node.tag;
        if (part.type === "universal") return true;
        if (part.type === "attribute") {
            return part.operation?.operator === "equal"
                ? node.attrs?.[part.name] === part.operation.value
                : part.name in (node.attrs || {});
        }
        if (part.type === "pseudo-element") return part.kind === node.pseudo;
        if (part.type === "pseudo-class") {
            if (["not", "where", "is"].includes(part.kind)) {
                const any = part.selectors.some(inner => matches(inner, node));
                return part.kind === "not" ? !any : any;
            }
            if (part.kind === "root") return node.root === true;
            return node.states.includes(part.kind);
        }
        return false;
    });
    if (!simple || split < 0) return simple;
    if (selector[split].value === "child") return matches(selector.slice(0, split), node.parent);
    if (selector[split].value !== "descendant") return false;
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (matches(selector.slice(0, split), parent)) return true;
    }
    return false;
}
function specificity(selector) {
    return selector.reduce(
        (sum, part) =>
            sum + (["class", "attribute"].includes(part.type)
                ? 100
                : part.type === "type"
                ? 1
                : part.type === "pseudo-class"
                ? part.kind === "where"
                    ? 0
                    : ["not", "is"].includes(part.kind)
                    ? Math.max(...part.selectors.map(specificity))
                    : 100
                : 0),
        0,
    );
}
function style(node, appliedRules = rules) {
    const result = new Map();
    for (const rule of appliedRules) {
        const matching = rule.selectors.filter(selector => matches(selector, node));
        if (!matching.length) continue;
        const weight = Math.max(...matching.map(specificity));
        for (const declaration of rule.declarations.declarations) {
            const name = declaration.property === "unparsed"
                ? declaration.value.propertyId.property
                : declaration.property === "custom"
                ? declaration.value.name
                : declaration.property;
            if (!result.has(name) || result.get(name).weight <= weight) {
                result.set(name, { weight, value: declaration.value });
            }
        }
    }
    return result;
}
for (const states of [[], ["hover"], ["focus-visible"], ["disabled"]]) {
    const outside = style(element("ui-button ui-button-danger", null, states));
    for (
        const parent of [
            element("ui-action-buttons", element("settings-section")),
            element("storage-actions", element("settings-section")),
        ]
    ) {
        const inside = style(element("ui-button ui-button-danger", parent, states));
        for (const property of ["color", "background", "border-color", "box-shadow", "opacity"]) {
            assert.deepEqual(
                inside.get(property)?.value,
                outside.get(property)?.value,
                `${property} must preserve danger semantics in ${states}`,
            );
        }
    }
}
console.log(
    "Parsed CSS cascade: danger colors, hover, focus and disabled appearance preserved inside settings and storage.",
);

const themeRules = [], lightOnly = new Set();
for (const file of ["../src/variables.css", "../src/app/base.css"]) {
    transform({
        filename: file,
        code: await readFile(new URL(file, import.meta.url)),
        visitor: {
            Rule(rule) {
                if (rule.type === "media" && JSON.stringify(rule.value.query).includes("prefers-color-scheme")) {
                    for (const child of rule.value.rules) {
                        if (child.type === "style") lightOnly.add(child.value.loc.line);
                    }
                }
                if (rule.type === "style") {
                    themeRules.push({
                        ...rule.value,
                        lightOnly: file.includes("variables") && lightOnly.has(rule.value.loc.line),
                    });
                }
            },
        },
    });
}
for (const systemLight of [false, true]) {
    for (const theme of ["dark", "light", "auto"]) {
        const root = { ...element(""), root: true, tag: "html", attrs: { "data-theme": theme } };
        const resolved = style(root, themeRules.filter(rule => !rule.lightOnly || systemLight));
        const expectedLight = theme === "light" || (theme === "auto" && systemLight);
        assert.equal(resolved.get("color-scheme").value.light, expectedLight);
        assert.equal(resolved.get("color-scheme").value.dark, !expectedLight);
        assert.ok(JSON.stringify(resolved.get("--studio-surface-control").value).includes("--overlay-subtle"));
        assert.ok(JSON.stringify(resolved.get("--studio-border-soft").value).includes("--overlay-border"));
    }
}
for (const context of ["ui-check-row", "batch-project-option"]) {
    const checkbox = {
        ...element("", element(context), ["checked"]),
        tag: "input",
        attrs: { type: "checkbox" },
        pseudo: "after",
    };
    assert.ok(JSON.stringify(style(checkbox).get("border").value).includes("--theme-contrast-color"));
}
const { Input } = await moduleAt("../src/ui/Input.tsx");
const change = () => {};
assert.equal(Input({ type: "number", onChange: change }).props.onChange, change);
assert.equal(Input({ type: "number" }).props.type, "number");
for (const states of [[], ["focus-visible"]]) {
    const plain = { ...element("ui-input", null, states), tag: "input" };
    const translation = { ...plain, parent: element("translation-language", element("translation-editor")) };
    for (const property of ["background", "color", "border", "border-color", "box-shadow"]) {
        assert.deepEqual(style(translation).get(property)?.value, style(plain).get(property)?.value);
    }
}
console.log(
    "Theme and form styles: explicit/automatic native color schemes, adaptive checkbox glyphs and custom-language input focus passed.",
);

const toolsHooks = hooks();
const { LrcUtilsPanel } = await moduleAt("../src/features/lrc-utils/LrcUtilsPanel.tsx", {
    react: toolsHooks.api,
    "../../hooks/useMessage.js": { useMessage: () => ["", () => {}, () => {}, false, "info", 0] },
    "../../ui/Toast.js": { toastPubSub: { pub() {} } },
});
let applied;
const tools = toolsHooks.render(() =>
    LrcUtilsPanel({
        open: true,
        text: "[ar:Test]\n[00:01.00]Hello",
        onClose() {},
        onApply: text => {
            applied = text;
        },
    })
);
assert.equal(nodes(tools).filter(node => node.type === "button").length, 0);
const action = nodes(tools).find(node => node.type === "ActionRow" && node.props.title === lang.toast.utils.removeTags);
// Resolve the first quick tool callback through its shared Button.
assert.ok(action);
nodes(action).find(node => node.type === "Button").props.onClick();
assert.equal(applied, "[00:01.00]Hello");
console.log("LRC tools: all actions use shared buttons; lyric transformation callbacks remain functional.");
