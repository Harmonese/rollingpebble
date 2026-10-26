# Source this file from Bash: source scripts/linux-env.sh
ROLLINGPEBBLE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export VIRTUAL_ENV="$ROLLINGPEBBLE_ROOT/.venv"
if [[ -x "$ROLLINGPEBBLE_ROOT/.tools/cargo/bin/rustup" && -d "$ROLLINGPEBBLE_ROOT/.tools/rustup/toolchains" ]]; then
    export CARGO_HOME="$ROLLINGPEBBLE_ROOT/.tools/cargo"
    export RUSTUP_HOME="$ROLLINGPEBBLE_ROOT/.tools/rustup"
    export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROLLINGPEBBLE_ROOT/.tools/cargo-target}"
    export PATH="$CARGO_HOME/bin:$PATH"
fi
export PATH="$VIRTUAL_ENV/bin:$ROLLINGPEBBLE_ROOT/.tools/node_modules/.bin:$PATH"
export PIP_CACHE_DIR="$ROLLINGPEBBLE_ROOT/.tools/pip-cache"
export npm_config_cache="$ROLLINGPEBBLE_ROOT/.tools/npm-cache"
export LRC_ROLLER_DATA_DIR="$ROLLINGPEBBLE_ROOT/.lrc-roller-data/linux-x86_64"
export PYTHON="$VIRTUAL_ENV/bin/python"

# Linux development does not bundle the macOS-only release resources.
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
if [[ -z "${TAURI_CONFIG:-}" ]]; then
    export TAURI_CONFIG='{"bundle":{"resources":[]}}'
fi
