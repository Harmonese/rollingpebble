import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const lang = JSON.parse(await readFile(new URL("../src/languages/en-US.json", import.meta.url), "utf8"));
const source = await readFile(new URL("../src/ui/ConfirmDialog.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
let cursor = 0;
const slots = [];
const jsx = (type, props) => ({ type, props });
const react = {
    createContext: () => ({ Provider: "Provider" }),
    useContext: () => ({ lang }),
    useState(value) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = value;
        return [slots[index], value => {
            slots[index] = value;
        }];
    },
    useRef(value) {
        return slots[cursor++] ??= { current: value };
    },
    useCallback: callback => callback,
    useEffect() {},
};
const exports = {};
new Function("require", "exports", code)(name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    return new Proxy({}, { get: (_target, key) => key });
}, exports);
function nodes(tree, output = []) {
    if (Array.isArray(tree)) tree.forEach(child => nodes(child, output));
    else if (tree && typeof tree === "object") {
        output.push(tree);
        nodes(tree.props?.children, output);
    }
    return output;
}
function render() {
    cursor = 0;
    return exports.ConfirmProvider({ children: "workspace" });
}
const ask = render().props.value;
const button = label => nodes(render()).find(node => node.type === "Button" && node.props.children === label);
const modal = () => nodes(render()).find(node => node.type === "Modal");
let pending = ask({ message: "Ordinary confirmation" });
assert.ok(button(lang.ui.cancel), "ordinary business confirmations must keep Cancel");
button(lang.ui.cancel).props.onClick();
assert.equal(await pending, "cancel");
pending = ask({ message: "Ordinary confirmation" });
modal().props.onClose();
assert.equal(await pending, "cancel");
for (const choice of ["confirm", "discard"]) {
    pending = ask({
        message: lang.ui.recoverWorkspace,
        requireDecision: true,
        confirmLabel: lang.ui.restore,
        discardLabel: lang.ui.discardChanges,
    });
    let resolved = false;
    pending.then(() => {
        resolved = true;
    });
    assert.equal(
        button(lang.ui.restore).props["data-autofocus"],
        "true",
        "Restore receives initial focus rather than Discard",
    );
    assert.equal(button(lang.ui.cancel), undefined, "recovery has exactly two explicit choices");
    assert.equal(nodes(render()).filter(node => node.type === "Button").length, 2);
    modal().props.onClose(); // Both Escape and backdrop dismissal invoke this handler.
    await Promise.resolve();
    assert.equal(resolved, false, "dismissal must leave the recovery decision open");
    assert.equal(modal().props.open, true);
    button(choice === "confirm" ? lang.ui.restore : lang.ui.discardChanges).props.onClick();
    assert.equal(await pending, choice);
    assert.equal(modal().props.open, false);
}
console.log(
    "Confirmation dialog: ordinary cancellation preserved; recovery requires explicit restore/discard and ignores dismissal.",
);

// Exercise actual modal focus selection without starting a browser or application.
const modalCode = ts.transpileModule(await readFile(new URL("../src/ui/Modal.tsx", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
for (const explicitFocus of [false, true]) {
    let refIndex = 0, selected;
    const callbacks = [];
    const first = {
        focus: () => {
            selected = "first";
        },
    };
    const preferred = {
        focus: () => {
            selected = "restore";
        },
    };
    const panel = {
        querySelector: selector => selector.startsWith("[data-autofocus") ? explicitFocus ? preferred : null : first,
    };
    const root = { style: {}, querySelector: () => panel, addEventListener() {}, removeEventListener() {} };
    globalThis.document = { activeElement: null, addEventListener() {}, removeEventListener() {} };
    const modalExports = {};
    new Function("require", "exports", modalCode)(name =>
        name === "react"
            ? {
                useRef: value => ({ current: refIndex++ === 0 ? root : value }),
                useState: value => [value, () => {}],
                useEffect: callback => callbacks.push(callback),
            }
            : { jsx, jsxs: jsx }, modalExports);
    modalExports.Modal({ open: true, onClose() {}, ariaLabel: "Recovery" });
    const cleanups = callbacks.map(callback => callback());
    assert.equal(selected, explicitFocus ? "restore" : "first");
    cleanups.forEach(cleanup => cleanup?.());
}
console.log("Modal focus: recovery prefers Restore; ordinary dialogs retain their first-control focus.");
