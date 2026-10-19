import * as cmCommands from "@codemirror/commands";
import * as cmState from "@codemirror/state";
import * as cmView from "@codemirror/view";
import * as parser from "@lrc-maker/lrc-parser/build/esm/lrc-parser.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function load(path, dependencies = {}) {
    const source = await readFile(new URL("../src/" + path, import.meta.url), "utf8");
    const code = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports = {};
    new Function("require", "exports", code)(name => {
        if (!(name in dependencies)) throw Error(name);
        return dependencies[name];
    }, exports);
    return exports;
}
const doc = await load("features/translation/pairedDocument.ts", { "../../domain/lyrics/lyricsDocument.js": parser });
const lines = [{ id: "a", time: 0, text: "First", translation: "第一句", source_text: "First" }, {
    id: "b",
    time: 2.12345,
    text: "Repeated",
    translation: "重复",
    source_text: "Repeated",
}, { id: "c", text: "Repeated", translation: "", source_text: "" }];
assert.equal(doc.pairedText(lines, 1, 2), "[00:00.00]第一句\n[00:02.12]重复\n");
assert.equal(doc.readPair("[00:03.00]First\n[00:02.12]Repeated\nRepeated", 0, lines, 2).lines[0].time, 3);
assert.equal(doc.readPair(doc.pairedText(lines, 0, 2), 0, lines, 2).lines[1].time, 2.12345);
assert.equal(doc.readPair("[00:]First\n[00:02.12]Repeated\nRepeated", 0, lines, 2).error, "timestamp");
assert.equal(doc.readPair("[00:99.00]First\n[00:02.12]Repeated\nRepeated", 0, lines, 2).error, "timestamp");
assert.equal(doc.readPair("[00:01.00]第一句\n[00:02.12]重复\n", 1, lines, 2).error, "timestamp");
assert.equal(doc.readPair("First\nRepeated", 0, lines, 2).error, "structure");
assert.equal(doc.readPair("First\nRepeated\nRepeated", 0, lines, 2).lines[0].time, undefined);
assert.equal(doc.translationPaste("甲\n乙\n丙", lines, 2), "[00:00.00]甲\n[00:02.12]乙\n丙");
assert.equal(doc.readPair("", 0, [], 2).lines.length, 0);
assert.equal(doc.readPair("Invented", 0, [], 2).error, "structure");
assert.equal(doc.readPair("[Chorus]", 0, [{ id: "section", text: "[Chorus]" }], 2).lines[0].text, "[Chorus]");
const heights = doc.pairedHeights([30, 90, 30], [60, 30, 120]);
assert.deepEqual(heights, [60, 90, 120]);
const anchor = doc.scrollAnchor(heights, 105);
assert.deepEqual(anchor, { index: 1, fraction: 0.5 });
assert.equal(doc.anchorTop([120, 60, 30], anchor), 150);

// Exercise actual CodeMirror transactions without opening or automating a page.
class View {
    static decorations = cmView.EditorView.decorations;
    static updateListener = cmView.EditorView.updateListener;
    static contentAttributes = cmView.EditorView.contentAttributes;
    static lineWrapping = [];
    static domEventHandlers = () => [];
    constructor({ state }) {
        this.state = state;
        this.hasFocus = false;
        this.scrollDOM = { scrollTop: 0 };
    }
    dispatch(spec) {
        const startState = this.state, tr = this.state.update(spec);
        this.state = tr.state;
        for (const listener of this.state.facet(View.updateListener)) {
            listener({
                state: this.state,
                startState,
                view: this,
                transactions: [tr],
                docChanged: tr.docChanged,
                selectionSet: Boolean(tr.selection),
            });
        }
    }
    focus() {
        this.hasFocus = true;
    }
    destroy() {}
}
globalThis.document = { createElement: () => ({ setAttribute() {}, remove() {} }) };
globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
const { PairedEditors } = await load("features/translation/PairedEditors.ts", {
    "@codemirror/state": cmState,
    "@codemirror/view": { ...cmView, EditorView: View },
    "@codemirror/commands": cmCommands,
    "./pairedDocument.js": doc,
});
let saved = lines, error = null, commits = 0;
const options = {
    lines,
    target: "zh",
    fixed: 2,
    stale: "stale",
    labels: ["Original", "Translation"],
    commit(next) {
        saved = next;
        commits++;
    },
    select() {},
    error(value) {
        error = value;
    },
};
const pair = new PairedEditors([{ append() {} }, { append() {} }], options);
const replace = (side, text, userEvent = "input") =>
    pair.views[side].dispatch({ changes: { from: 0, to: pair.views[side].state.doc.length, insert: text }, userEvent });
replace(1, "甲\n乙\n丙", "input.paste");
assert.deepEqual(saved.map(line => line.translation), ["甲", "乙", "丙"]);
assert.deepEqual(saved.map(line => line.id), ["a", "b", "c"]);
assert.equal(commits, 1);
replace(0, "[00:05.00]Changed\n[00:02.12]Repeated\nRepeated");
assert.equal(saved[0].time, 5);
assert.equal(saved[0].source_text, "First");
assert.match(pair.views[1].state.doc.toString(), /^\[00:05.00\]甲/);
pair.undo(false);
assert.equal(saved[0].text, "First");
assert.equal(saved[0].time, 0);
pair.undo(true);
assert.equal(saved[0].text, "Changed");
assert.equal(saved[0].time, 5);
const before = pair.views[1].state.doc.toString();
replace(1, "[00:06.00]甲\n[00:02.12]乙\n丙");
assert.equal(pair.views[1].state.doc.toString(), before);
replace(0, "[00:]Changed\n[00:02.12]Repeated\nRepeated");
assert.equal(pair.validate(), false);
assert.equal(error, "timestamp");
assert.equal(saved[0].time, 5);
pair.update({ ...options, lines: saved, fixed: 3 });
assert.match(pair.views[0].state.doc.toString(), /^\[00:\]/); // Preferences do not erase unfinished input.
pair.undo(false);
assert.equal(pair.validate(), true);
replace(0, "Shorter\nDocument");
assert.equal(saved.length, 3);
const remote = saved.map(line => ({ ...line, translation: "Remote" }));
pair.update({ ...options, lines: remote });
pair.undo(false);
assert.match(pair.views[1].state.doc.toString(), /Remote/); // Remote replacement resets undo.
pair.destroy();
let savedTarget = null;
const untargeted = new PairedEditors([{ append() {} }, { append() {} }], {
    ...options,
    lines: [{ id: "a", text: "First", time: 0 }],
    target: "",
    editTarget: "zh",
    commit(_, target) {
        savedTarget = target;
    },
});
untargeted.views[0].dispatch({
    changes: { from: 0, to: untargeted.views[0].state.doc.length, insert: "[00:04.00]First" },
});
assert.equal(savedTarget, ""); // Timing-only edits do not change the translation request identity.
untargeted.views[1].dispatch({ changes: { from: 10, insert: "译文" } });
assert.equal(savedTarget, "zh");
untargeted.destroy();
const guard = await load("shared/editorDraft.ts");
const release = guard.registerEditorDraft(() => "invalid");
assert.equal(guard.editorDraftError(), "invalid");
release();
assert.equal(guard.editorDraftError(), null);
console.log(
    "Paired editor: timestamps, precision, paste, row guards, shared heights, scroll anchors, undo/redo and external resets passed.",
);
