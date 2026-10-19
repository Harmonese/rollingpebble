import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const listeners = new Map(), calls = [];
globalThis.window = {
    __TAURI_INTERNALS__: {
        async invoke(name, args) {
            calls.push([name, args]);
        },
    },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
};
const source = await readFile(new URL("../src/shared/desktopExit.ts", import.meta.url), "utf8");
const exports = {};
new Function("exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(
    exports,
);
let release, count = 0;
const stop = exports.registerDesktopExit(() => {
    count++;
    return new Promise(resolve => {
        release = resolve;
    });
});
assert.equal(calls[0][0], "workspace_ready");
const exit = listeners.get("rollingpebble:exit-requested");
exit();
exit();
assert.equal(count, 1);
assert.equal(calls.length, 1);
release(false);
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(calls.at(-1), ["workspace_exit_reply", { approved: false }]);
exit();
release(true);
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(calls.at(-1), ["workspace_exit_reply", { approved: true }]);
stop();
assert.equal(listeners.size, 0);
console.log("Desktop exit waits for saves, merges duplicate requests and honors cancel/approval.");
