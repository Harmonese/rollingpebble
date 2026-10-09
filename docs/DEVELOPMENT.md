# Development

Run commands from the repository root unless a command explicitly changes directory. Source development needs Python 3.10+, Node.js and pnpm (the repository pins pnpm 10.11.0). Auto Timing needs a separate Python 3.12 runtime.

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[dev]'
pnpm install
rollingpebble dev
```

On Windows activate `.venv\Scripts\Activate.ps1` in PowerShell. The frontend development server is `127.0.0.1:5173`; it proxies `/api` to the default backend at `127.0.0.1:6789`. If changing the backend port, adjust the Vite proxy too.

Alternatively run `rollingpebble serve --reload` and `pnpm dev` in separate terminals. `pnpm build` produces `frontend/dist`; `rollingpebble serve` serves built assets. See [Desktop packaging](DESKTOP.md) for the native shell.

## Boundaries

- `frontend/src/app`: workspace composition and orchestration.
- `frontend/src/domain`: lyrics, timing options, and audio-domain behavior.
- `frontend/src/features`: project, import, timing, publishing and settings panels.
- `frontend/src/ui`: reusable controls, modal and confirmation behavior.
- `frontend/src/shared`: API contracts, events and shared helpers.
- `backend/rollingpebble/api`: HTTP contracts; business behavior belongs in services.
- `backend/rollingpebble/runtime`: isolated environment, installation and reports.
- `desktop` and `src-tauri`: native packaging and backend lifecycle.

Reuse existing panels, buttons, action rows, theme variables and localized messages. Keep transient audio separate from saved ProjectModel identity. New features must not silently persist a temporary workspace.

## Checks

```sh
pnpm -C frontend check:type
pnpm -C frontend check:lint
pnpm -C frontend check:i18n:zh
python -m ruff check backend tests desktop
python -m pytest -q
pnpm -C frontend build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
```

The Chinese i18n gate is required. Other locales still contain historical English fallback text. Run dprint on changed frontend files; avoid unrelated whole-repository formatting churn.

For interactive checks use a separate `LRC_ROLLER_DATA_DIR`. Verify the project directory remains empty after import, one complete project appears after saving, repeated saves do not copy audio again, and confirmation cancel/undo behave correctly in both browser and native shell. Generated local QA artifacts belong under ignored `output/`.

[Architecture](ARCHITECTURE.md) describes state and service contracts. [Release checklist](RELEASE.md) defines distribution acceptance.
