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
const document = await load("domain/lyrics/translationDocument.ts");
const engine = await load("domain/lyrics/useLyricsEngine.ts", {
    react: {},
    "@lrc-maker/lrc-parser": parser,
    "./translationDocument.js": document,
});
const domain = await load("domain/lyrics/lyricsDocument.ts", {
    "@lrc-maker/lrc-parser": parser,
    "./useLyricsEngine.js": engine,
});
const A = engine.ActionType, options = { trimStart: true, trimEnd: true };
let state = engine.init(() => ({ text: "[00:00.00]One\n[00:02.00]Two", options, select: 0 }));
const update = (type, payload) => state = engine.reducer(state, { type, payload });
const ids = state.lyric.map(l => l.id);
update(A.translate, { target: "zh", lines: [{ id: ids[1], text: "二" }, { id: ids[0], text: "一" }] });
assert.deepEqual(state.lyric.map(l => l.translation), ["一", "二"]);
const identity = document.translationIdentity(state.lyric, state.targetLanguage);
update(A.time, 1);
assert.equal(document.translationIdentity(state.lyric, state.targetLanguage), identity);
update(A.editLine, { id: ids[0], field: "text", value: "First" });
assert.equal(state.lyric[0].source_text, "One");
update(A.editLine, { id: ids[0], field: "translation", value: "第一" });
assert.equal(state.lyric[0].source_text, "First");
update(A.select, () => 0);
update(A.markLine, {});
update(A.insertMarkedLine, { slot: 0, time: 1.5 });
assert.equal(state.lyric[0].translation, "第一");
assert.notEqual(state.lyric[0].id, ids[0]);
update(A.undoMarkedLine);
update(A.deleteLine);
assert.equal(state.lyric.length, 1);
update(A.undoMarkedLine);
assert.deepEqual(state.lyric.map(l => l.id), ids);
const before = state;
update(A.parse, { text: "Split\nLine\nTwo", options, preserveTranslation: true, undoable: true });
assert.equal(state.lyric[0].translation, undefined);
assert.equal(state.lyric[2].translation, "二");
update(A.undoParse);
assert.equal(state, before);
const changed = document.reconcileLines(state.lyric, [{ text: "First modified", time: 9 }, { text: "Two", time: 10 }]);
assert.equal(changed.lost, 0);
assert.equal(changed.lines[0].id, ids[0]);
assert.equal(changed.lines[0].source_text, "First");
const repeats = [{ id: "a", text: "Same", time: 1, translation: "甲" }, {
    id: "b",
    text: "Same",
    time: 2,
    translation: "乙",
}];
assert.deepEqual(
    document.reconcileLines(repeats, [...repeats].reverse().map(({ text, time }) => ({ text, time }))).lines.map(l =>
        l.id
    ),
    ["b", "a"],
);
assert.equal(document.reconcileLines(repeats, [{ text: "Same" }]).lost, 2);
const pref = { fixed: 2, spaceStart: 0, spaceEnd: 0, endOfLine: "\n" };
const bilingual = domain.lyricsDocumentExport(state, "bilingual", pref, false);
assert.match(bilingual, /\[00:01.00\]First\n\[00:01.00\]第一/);
assert.equal(domain.lyricsDocumentExport(state, "translation", pref, false), "[00:01.00]第一\n[00:02.00]二");
const source = domain.lyricsDocumentSyncedText(state, pref, false);
const saved = JSON.parse(JSON.stringify({ version: 1, source_lrc: source, target_language: "zh", lines: state.lyric }));
assert.deepEqual(document.restoreDocument(saved, source, parser.parser(source, options).lyric), state.lyric);
for (const newline of ["\r\n", "\r", "\n"]) {
    const alternate = { ...saved, source_lrc: source.replace(/\n/g, newline) };
    assert.deepEqual(document.restoreDocument(alternate, source, parser.parser(source, options).lyric), state.lyric);
    assert.equal(document.restoreDocument(alternate, source.replace("First", "Changed"), state.lyric), null);
}
assert.equal(document.restoreDocument(saved, source + "Other", state.lyric), null);
update(A.parse, { text: "New document", options });
assert.equal(state.targetLanguage, "");
assert.equal(document.hasTranslation(state.lyric), false);
console.log(
    "Translation identities, timing, source edits, duplicate insertion, deletion, undo, ambiguity, recovery and exports passed.",
);
