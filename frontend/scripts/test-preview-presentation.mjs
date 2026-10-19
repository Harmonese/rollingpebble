import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/features/roller/previewPresentation.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function("require", "exports", compiled)(
    () => ({ isRunActive: run => ["queued", "running", "cancelling"].includes(run.status) }),
    exports,
);
const show = exports.showPreviewEditor;
for (const status of ["queued", "running", "cancelling"]) {
    assert.equal(show({ status, snapshot: null }, true, false), false);
    assert.equal(show({ status, snapshot: { lines: [] } }, true, false), false);
    assert.equal(show({ status, snapshot: { lines: [], unaligned_lines: [{}] } }, true, false), true);
    assert.equal(show({ status, snapshot: { lines: [{}] } }, true, false), true);
    assert.equal(show({ status, snapshot: { lines: [] } }, true, true), true);
    assert.equal(show({ status, snapshot: { lines: [{}] } }, false, false), false);
}
for (const status of ["completed", "failed", "cancelled", "interrupted"]) {
    assert.equal(show({ status, snapshot: { lines: [] } }, true, false), true);
    assert.equal(show({ status, snapshot: null }, true, true), true);
}
console.log("Preview presentation cases passed");
