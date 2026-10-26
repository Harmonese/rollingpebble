#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/linux-env.sh"
cd "$ROLLINGPEBBLE_ROOT"
python -m ruff check backend tests desktop scripts
python -m pytest -q
pnpm -C frontend check:type
pnpm -C frontend check:lint
pnpm -C frontend check:i18n:zh
for test_script in frontend/scripts/test-*.mjs; do
    node "$test_script"
done
pnpm build
if [[ "${1:-}" == "--native" ]]; then
    cargo fmt --manifest-path src-tauri/Cargo.toml --check
    cargo test --locked --manifest-path src-tauri/Cargo.toml
fi
