import "./test-workspace-autosave.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// The player must also discard asynchronous decode completion after a reset.
const footer = await readFile(new URL("../src/app/Footer.tsx", import.meta.url), "utf8");
const receiveCode = ts.transpileModule(
    footer.slice(footer.indexOf("const receiveFile = (")).replace("const receiveFile", "export const receiveFile"),
    {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    },
).outputText;
let resolveDecode, currentDecode = true, loaded = 0;
const receiver = {};
new Function("exports", "prepareAudioFile", "toastPubSub", "audioImportErrorText", receiveCode)(
    receiver,
    () =>
        new Promise(resolve => {
            resolveDecode = resolve;
        }),
    { pub() {} },
    () => "error",
);
receiver.receiveFile(new File(["audio"], "a.wav"), () => loaded++, {}, () => currentDecode);
currentDecode = false;
resolveDecode({ file: new File(["decoded"], "a.wav") });
await Promise.resolve();
assert.equal(loaded, 0);
console.log("Player rejects decoded audio belonging to a cleared workspace.");
