import { spawnSync } from "node:child_process";
import { exportArtifacts } from "./export_artifacts.mjs";

// Drop only the legacy local Linux development override, never arbitrary user config.
const env = { ...process.env };
if (env.TAURI_CONFIG === '{"bundle":{"resources":[]}}') delete env.TAURI_CONFIG;
const args = process.argv.slice(2);
const result = spawnSync("pnpm", ["exec", "tauri", "build", ...args], {
    env, stdio: "inherit", shell: process.platform === "win32",
});
if (result.status !== 0) process.exit(result.status ?? 1);
if (!args.includes("--no-bundle")) await exportArtifacts(args);
