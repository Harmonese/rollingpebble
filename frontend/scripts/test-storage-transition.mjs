import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/shared/storageTransition.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { prepareStorageTransition, registerStorageTransition } = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
assert.equal(await prepareStorageTransition(), false);
const calls = [];
const removeFirst = registerStorageTransition(async () => {
    calls.push("old");
    return true;
});
const removeCurrent = registerStorageTransition(async () => {
    calls.push("flush");
    await Promise.resolve();
    calls.push("save-prompt");
    return false;
});
removeFirst();
assert.equal(await prepareStorageTransition(), false);
assert.deepEqual(calls, ["flush", "save-prompt"]);
removeCurrent();
assert.equal(await prepareStorageTransition(), false);
registerStorageTransition(async () => {
    throw new Error("Draft save failed");
});
await assert.rejects(prepareStorageTransition, /Draft save failed/);
console.log("Storage transition: workspace guard, cancellation, unmount and save failure passed.");
