#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/linux-env.sh"
cd "$ROLLINGPEBBLE_ROOT"
pnpm build
python - <<'PY'
from pathlib import Path
import shutil

destination = Path('backend/rollingpebble/frontend_dist')
if destination.exists():
    shutil.rmtree(destination)
shutil.copytree('frontend/dist', destination)
PY
python -m build --no-isolation
python -m pip freeze > dist/linux-x86_64-python-freeze.txt
sha256sum dist/rollingpebble-*.whl dist/rollingpebble-*.tar.gz > dist/SHA256SUMS
