import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const lang = JSON.parse(await readFile(new URL("../src/languages/zh-CN.json", import.meta.url), "utf8"));
async function load(path, require) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    const code = ts.transpileModule(source, {
        fileName: path,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports = {};
    new Function("require", "exports", code)(require, exports);
    return exports;
}
const writes = [];
const api = await load(
    "../src/shared/api/timingV2.ts",
    () => ({ request: async (url, options) => writes.push([url, JSON.parse(options.body)]) }),
);
assert.equal(api.defaultTimingOptions.language, "auto");
await api.rememberTimingLanguage("zh");
assert.deepEqual(writes, [["/api/settings", { auto_timing_v2_options: { language: "zh" } }]]);
const jsx = (type, props) => ({ type, props });
const ui = await load("../src/features/roller/AutoTimingFields.tsx", name => {
    if (name === "react") return { useContext: () => ({ lang }) };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name.includes("ui/index")) return { FormGrid: "FormGrid", CheckRow: "CheckRow" };
    return {};
});
let options = {
    ...api.defaultTimingOptions,
    ctc_model: "/english",
    ctc_zh_model: "/mandarin",
    ctc_mul_model: "/phoneme",
};
const changed = [];
const at = {
    options,
    setOptions: value => {
        options = value;
    },
};
const tree = ui.AutoTimingFields({ at, onLanguageChange: value => changed.push(value) });
function all(tree, type) {
    if (Array.isArray(tree)) return tree.flatMap(item => all(item, type));
    if (!tree?.props) return [];
    return [...(tree.type === type ? [tree] : []), ...all(tree.props.children, type)];
}
const language = all(tree, "select").find(select => all(select, "option").some(option => option.props.value === "mul"));
assert.ok(language);
assert.deepEqual(all(language, "option").map(option => option.props.value), ["auto", "en", "zh", "zh-en", "mul"]);
language.props.onChange({ target: { value: "zh" } });
assert.equal(options.language, "zh");
assert.equal(options.ctc_model, "/english");
assert.equal(options.ctc_zh_model, "/mandarin");
assert.deepEqual(changed, ["zh"]);
const inputs = all(tree, "input");
inputs.find(input => input.props.value === "/phoneme").props.onChange({ target: { value: "/new-phoneme" } });
assert.equal(options.ctc_mul_model, "/new-phoneme");
assert.equal(options.ctc_model, "/english");
assert.equal(options.ctc_zh_model, "/mandarin");
console.log("Timing languages: shared selects, Auto default, preference patch and isolated CTC fields passed.");
