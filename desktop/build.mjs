import { spawnSync } from "node:child_process";

const candidates = [
    process.env.ROLLINGPEBBLE_BUILD_PYTHON,
    "build/python-build-runtime/python.exe",
    "desktop/python-runtime/python.exe",
    ".venv/Scripts/python.exe",
    "build/python-build-runtime/bin/python3.12",
    "desktop/python-runtime/bin/python3.12",
    ".venv/bin/python",
    "python3",
].filter(Boolean);
const python = candidates.find(candidate => spawnSync(candidate, ["-c", "import ssl, sys; assert sys.version_info >= (3, 12)"]).status === 0);
if (!python) throw new Error("Desktop packaging requires a working Python 3.12+ with SSL");
const result = spawnSync(python, ["desktop/build_resources.py"], { stdio: "inherit" });
process.exit(result.status ?? 1);
