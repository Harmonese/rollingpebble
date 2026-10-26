import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/shared/playbackRate.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const rate = {};
new Function("exports", code)(rate);
assert.equal(rate.playbackRateFromLog(-rate.PLAYBACK_LOG_LIMIT), 1 / 3);
assert.equal(rate.playbackRateFromLog(rate.PLAYBACK_LOG_LIMIT), 3);
assert.equal(rate.playbackRateFromLog(0), 1);
assert.equal(rate.playbackRateToLog(1), 0);
let value = 1;
for (let i = 0; i < 100; i++) value = rate.stepPlaybackRate(value, 1);
assert.equal(value, 3);
for (let i = 0; i < 100; i++) value = rate.stepPlaybackRate(value, -1);
assert.equal(value, 1 / 3);
for (const input of [1 / 3, 0.5, 1, 1.5, 2, 3]) {
    assert.ok(Math.abs(rate.playbackRateFromLog(rate.playbackRateToLog(input)) - input) < 1e-12);
    assert.ok(rate.stepPlaybackRate(input, 1) <= 3);
    assert.ok(rate.stepPlaybackRate(input, -1) >= 1 / 3);
}
assert.equal(rate.clampPlaybackRate(Infinity), 1);
assert.equal(rate.clampPlaybackRate(NaN), 1);
assert.equal(rate.clampPlaybackRate(-1), 1 / 3);
assert.equal(rate.clampPlaybackRate(4), 3);
console.log("Playback rate: exact endpoints, logarithmic mapping, repeated steps and assignment bounds passed.");
