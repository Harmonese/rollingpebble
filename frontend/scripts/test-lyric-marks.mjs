import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const temp = await mkdtemp(new URL("node_modules/.lyric-marks-test-", root));
async function load(name, source) {
    const code = ts.transpileModule(await readFile(new URL(source, root), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText;
    const path = resolve(temp, name + ".mjs");
    await writeFile(
        path,
        code.replaceAll("\"@lrc-maker/lrc-parser\"", "\"@lrc-maker/lrc-parser/build/esm/lrc-parser.js\""),
    );
    return import(pathToFileURL(path));
}
try {
    const { init, reducer, ActionType: A } = await load("engine", "src/domain/lyrics/useLyricsEngine.ts");
    const { lyricMarkKey, synchronizerCommand, blocksSynchronizerKeys } = await load(
        "keys",
        "src/utils/lyricMarkKeys.ts",
    );
    const options = { trimStart: true, trimEnd: true };
    let state = init(() => ({ text: "[00:01.00]One\n[00:02.00]Two", options, select: 0 }));
    const dispatch = (type, payload) => state = reducer(state, { type, payload });
    assert.deepEqual(state.marks, []);
    for (let slot = 0; slot < 10; slot++) dispatch(A.markLine, { slot });
    assert.deepEqual(state.marks.map(mark => mark.text), ["One"]);
    dispatch(A.select, () => 1);
    dispatch(A.markLine, { slot: 9 });
    dispatch(A.select, () => 0);
    dispatch(A.insertMarkedLine, { slot: 0, time: 1.2 });
    dispatch(A.insertMarkedLine, { slot: 1, time: 1.5 });
    assert.deepEqual(state.lyric.map(l => [l.text, l.time]), [["One", 1.2], ["Two", 1.5], ["One", 1], ["Two", 2]]);
    assert.equal(state.selectIndex, 2);
    dispatch(A.refresh, 1.6);
    dispatch(A.undoMarkedLine);
    assert.equal(state.lyric.length, 3);
    dispatch(A.undoMarkedLine);
    assert.deepEqual(state.lyric.map(l => l.text), ["One", "Two"]);
    assert.equal(state.selectIndex, 0);
    dispatch(A.unmarkLine, {});
    assert.deepEqual(state.marks.map(mark => mark.text), ["Two"]);
    const before = state;
    dispatch(A.insertMarkedLine, { slot: 9, time: 0 });
    assert.equal(state, before);
    dispatch(A.insertMarkedLine, { slot: 0, time: 0 });
    assert.equal(state.lyric[0].time, 0);
    dispatch(A.time, 0.5);
    assert.equal(state.insertHistory.length, 0); // Never undo later timing edits accidentally.
    dispatch(A.parse, { text: "Edited", options, preserveMarks: true });
    assert.equal(state.marks[0].text, "Two");
    dispatch(A.parse, { text: "New workspace", options });
    assert.deepEqual(state.marks, []);
    dispatch(A.parse, { text: Array.from({ length: 15 }, (_, i) => `Line ${i}`).join("\n"), options });
    for (let index = 0; index < 15; index++) {
        dispatch(A.select, () => index);
        dispatch(A.markLine, {});
    }
    assert.equal(state.marks.length, 15);
    assert.equal(new Set(state.marks.map(mark => mark.id)).size, 15);
    const retained = state.marks[2];
    dispatch(A.unmarkLine, { slot: 1 });
    assert.equal(state.marks[1], retained);
    dispatch(A.insertMarkedLine, { slot: 13, time: 22 });
    assert.equal(state.lyric[state.selectIndex].text, "Line 14");
    dispatch(A.select, index => index - 1);
    dispatch(A.unmarkLine, {}); // Unmark also works from an inserted copy.
    assert.equal(state.marks.length, 13);
    dispatch(A.parse, { text: "Replacement", options, preserveMarks: true });
    dispatch(A.select, () => 0);
    const replaceId = state.marks[0].id;
    dispatch(A.markLine, { slot: 0 });
    assert.deepEqual(state.marks[0], { id: replaceId, text: "Replacement" });
    const unique = state;
    dispatch(A.markLine, { slot: 2 });
    assert.equal(state, unique); // Existing text never replaces another mark.
    dispatch(A.parse, { text: "", options });
    dispatch(A.markLine, {});
    assert.deepEqual(state.marks, []);
    const event = { code: "Digit0", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    assert.equal(lyricMarkKey(event), null);
    assert.deepEqual(lyricMarkKey({ ...event, altKey: true }), { slot: 9, action: "insert" });
    assert.deepEqual(lyricMarkKey({ ...event, code: "Digit1", metaKey: true }), { slot: 0, action: "mark" });
    assert.deepEqual(lyricMarkKey({ ...event, code: "Numpad5", ctrlKey: true }), { slot: 4, action: "mark" });
    assert.equal(lyricMarkKey({ ...event, ctrlKey: true, altKey: true }), null);
    assert.equal(lyricMarkKey({ ...event, altKey: true, shiftKey: true }), null);
    assert.deepEqual(lyricMarkKey({ ...event, ctrlKey: true, shiftKey: true }), { slot: 9, action: "unmark" });
    assert.deepEqual(lyricMarkKey({ ...event, code: "Digit1", metaKey: true, shiftKey: true }), {
        slot: 0,
        action: "unmark",
    });
    dispatch(A.parse, { text: "[00:00.00]Start\n[00:02.00]End", options });
    dispatch(A.select, () => 0);
    dispatch(A.markLine, {});
    dispatch(A.select, () => 1);
    dispatch(A.next, 3);
    assert.equal(state.selectIndex, state.lyric.length);
    const placeholder = state;
    for (const [type, payload] of [[A.next, 4], [A.time, 4], [A.deleteTime], [A.deleteLine], [A.markLine, {}]]) {
        dispatch(type, payload);
        assert.equal(state, placeholder);
    }
    dispatch(A.insertMarkedLine, { slot: 0, time: 4 });
    dispatch(A.insertMarkedLine, { slot: 0, time: 5 });
    assert.deepEqual(state.lyric.map(l => l.time), [0, 3, 4, 5]);
    assert.equal(state.selectIndex, 4);
    dispatch(A.selectPlaying, 0);
    assert.equal(state.selectIndex, 0);
    dispatch(A.selectPlaying, 4.5);
    assert.equal(state.selectIndex, 2);
    dispatch(A.deleteLine);
    assert.deepEqual(state.lyric.map(l => l.time), [0, 3, 5]);
    assert.equal(state.selectIndex, 2);
    dispatch(A.undoMarkedLine);
    assert.deepEqual(state.lyric.map(l => l.time), [0, 3, 4, 5]);
    assert.equal(state.selectIndex, 2);
    dispatch(A.undoMarkedLine);
    assert.deepEqual(state.lyric.map(l => l.time), [0, 3, 4]);
    assert.equal(state.selectIndex, 3);
    dispatch(A.select, () => 2);
    dispatch(A.deleteLine);
    assert.equal(state.selectIndex, state.lyric.length);
    dispatch(A.select, () => 0);
    dispatch(A.deleteLine);
    dispatch(A.deleteLine);
    assert.equal(state.lyric.length, 0);
    assert.equal(state.selectIndex, 0);
    assert.equal(state.marks[0].text, "Start");
    dispatch(A.insertMarkedLine, { slot: 0, time: 6 });
    assert.deepEqual(state.lyric, [{ text: "Start", time: 6 }]);
    assert.equal(state.selectIndex, 1);
    const unmatched = state;
    dispatch(A.selectPlaying, 1);
    assert.equal(state, unmatched);
    for (let i = 0; i < 105; i++) dispatch(A.insertMarkedLine, { slot: 0, time: 7 + i });
    assert.equal(state.insertHistory.length, 100);
    dispatch(A.parse, { text: "Changed", options, preserveMarks: true });
    assert.equal(state.insertHistory.length, 0);
    assert.equal(state.marks.length, 1);
    dispatch(A.parse, { text: "New project", options });
    assert.equal(state.marks.length, 0);
    dispatch(A.info, { name: "ti", value: "Manual title" });
    dispatch(A.info, { name: "ar", value: "Singer" });
    dispatch(A.parse, { text: "[ti:Imported title]\nNew lyrics", options, preserveMetadata: true });
    assert.equal(state.info.get("ti"), "Imported title");
    assert.equal(state.info.get("ar"), "Singer");
    assert.deepEqual(state.marks, []);
    dispatch(A.parse, { text: "Another project", options });
    assert.equal(state.info.has("ar"), false);
    assert.equal(synchronizerCommand({ ...event, code: "Digit1" }), "selectPlaying");
    for (const modifier of ["altKey", "metaKey", "ctrlKey", "shiftKey"]) {
        assert.equal(synchronizerCommand({ ...event, code: "Digit1", [modifier]: true }), null);
    }
    for (const code of ["Delete", "Backspace"]) {
        assert.equal(synchronizerCommand({ ...event, code }), null);
        assert.equal(synchronizerCommand({ ...event, code, metaKey: true }), "deleteLine");
        assert.equal(synchronizerCommand({ ...event, code, ctrlKey: true }), "deleteLine");
    }
    assert.equal(synchronizerCommand({ ...event, code: "KeyZ", metaKey: true }), "undoMarkedLine");
    assert.equal(blocksSynchronizerKeys(null), false);
    for (const selector of ["input", "textarea", "select", "[role=dialog]", "[contenteditable]"]) {
        assert.equal(blocksSynchronizerKeys({ closest: query => query.includes(selector) ? {} : null }), true);
    }
    console.log(
        "Lyric marks: dynamic list, deduplication, reindexing, insertion, undo, resets, snapshots and shortcuts passed.",
    );
} finally {
    await rm(temp, { recursive: true, force: true });
}
