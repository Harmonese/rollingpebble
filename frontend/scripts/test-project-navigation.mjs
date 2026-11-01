import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const lang = JSON.parse(await readFile(new URL("../src/languages/en-US.json", import.meta.url), "utf8"));
const slots = [], effects = [];
let cursor = 0, rows = ["A", "B", "C", "D"].map(project_id => ({ project_id }));
let props, opened = [], savedOrder = [], opening, rejectOpen = false;
const target = new EventTarget();
globalThis.window = target;
const react = {
    useState(initial) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
        return [slots[i], value => {
            slots[i] = typeof value === "function" ? value(slots[i]) : value;
        }];
    },
    useRef(initial) {
        return slots[cursor++] ??= { current: initial };
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
    useMemo: fn => fn(),
    useContext: () => ({ lang }),
};
const jsx = (type, props) => ({ type, props });
const exports = {};
const code =
    ts.transpileModule(await readFile(new URL("../src/features/project/ProjectPanel.tsx", import.meta.url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
new Function("require", "exports", code)(name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name.includes("useSettingsUpdated")) return { useSettingsUpdated() {} };
    if (name.includes("api/projects")) return { listProjects: async () => [...rows] };
    if (name.includes("browserStorage")) {
        return {
            readLocalText: () => JSON.stringify(savedOrder),
            writeLocalText: (_key, value) => {
                savedOrder = JSON.parse(value);
            },
        };
    }
    if (name.includes("useMessage")) return { useMessage: () => ["", () => {}, () => {}] };
    if (name.includes("ConfirmDialog")) return { useConfirmDialog: () => async () => "cancel" };
    if (name.includes("projectEvents")) return { PROJECTS_CHANGED_EVENT: "projects-changed" };
    return new Proxy({}, { get: (_target, name) => name });
}, exports);
props = {
    project: rows[0],
    saving: false,
    transitioning: false,
    async onOpenProject(id) {
        opened.push(id);
        if (opening) await opening;
        if (rejectOpen) return;
        props.project = rows.find(row => row.project_id === id);
        // Opening rewrites metadata, changing backend directory-mtime ordering.
        rows = [props.project, ...rows.filter(row => row.project_id !== id)];
    },
};
function nodes(tree) {
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    return tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : [];
}
function render() {
    cursor = 0;
    const tree = nodes(exports.ProjectPanel(props));
    effects.splice(0).forEach(fn => fn());
    return Object.fromEntries(
        ["ProjectSwitcher", "RecentProjectList"].map(type => [type, tree.find(node => node.type === type).props]),
    );
}
async function settle() {
    render();
    await new Promise(resolve => setImmediate(resolve));
    render();
    await new Promise(resolve => setImmediate(resolve));
    return render();
}
await settle();
for (const id of ["B", "C", "D"]) {
    render().ProjectSwitcher.onSwitch(1);
    const tree = await settle();
    assert.equal(props.project.project_id, id, "next traverses all projects despite backend reordering");
    assert.equal(tree.RecentProjectList.projects[0].project_id, id, "recent list still refreshes");
}
assert.deepEqual(opened, ["B", "C", "D"]);
render().ProjectSwitcher.onSwitch(1);
assert.equal(opened.length, 3, "no wrap beyond last project");
for (const id of ["C", "B", "A"]) {
    render().ProjectSwitcher.onSwitch(-1);
    await settle();
    assert.equal(props.project.project_id, id);
}
render().ProjectSwitcher.onSwitch(-1);
assert.equal(opened.length, 6, "no wrap before first project");
rejectOpen = true;
render().ProjectSwitcher.onSwitch(1);
await settle();
assert.equal(render().ProjectSwitcher.currentIndex, 0, "cancelled switch retains position");
rejectOpen = false;
let release;
opening = new Promise(resolve => {
    release = resolve;
});
render().ProjectSwitcher.onSwitch(1);
assert.equal(render().ProjectSwitcher.disabled, true, "arrows disabled while awaiting transition");
release();
opening = null;
await settle();
props.saving = true;
assert.equal(render().ProjectSwitcher.disabled, true);
props.saving = false;
// A drag explicitly updates both persistent ordering and arrow traversal.
let list = render().RecentProjectList;
list.onDragStart({ preventDefault() {}, dataTransfer: { setData() {} } }, "D");
render().RecentProjectList.onDrop("A");
await settle();
assert.deepEqual(savedOrder, ["B", "D", "A", "C"]);
render().ProjectSwitcher.onSwitch(1);
await settle();
assert.equal(props.project.project_id, "D", "arrows follow explicit drag order");
rows = rows.filter(row => row.project_id !== "A");
target.dispatchEvent(new Event("projects-changed"));
await settle();
render().ProjectSwitcher.onSwitch(1);
await settle();
assert.equal(props.project.project_id, "C", "deleted projects removed from navigation");
rows.unshift({ project_id: "E" });
target.dispatchEvent(new Event("projects-changed"));
await settle();
assert.equal(render().ProjectSwitcher.total, 4, "new projects admitted without reordering existing traversal");
slots.forEach(slot => slot?.cleanup?.());
console.log(
    "Project navigation: full forward/backward traversal, recency refresh, boundaries, cancel/busy, drag ordering and membership changes passed.",
);
