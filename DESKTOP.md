# Desktop App Prototype

Rolling Pebble can be packaged as a lightweight Tauri desktop app while keeping the existing React frontend and Python backend.

The desktop shell does not replace the backend. It starts a local Rolling Pebble server on a random `127.0.0.1` port, then opens a native WebView window pointed at that server.

## Architecture

```text
Tauri window
  -> http://127.0.0.1:<random-port>
  -> Rolling Pebble Python backend
  -> bundled frontend_dist or source frontend/dist
```

Development fallback:

- The Tauri shell runs `python3 -m rollingpebble.cli serve ...`.
- Set `PYTHON=/path/to/python` to choose a Python executable.
- Set `ROLLINGPEBBLE_BACKEND=/path/to/rollingpebble-backend` to run a prebuilt sidecar.

Production goal:

- Build the frontend.
- Build a platform-specific Python sidecar with PyInstaller.
- Bundle that sidecar into the Tauri app.

## Requirements

- Rust toolchain: <https://rustup.rs>
- Node.js and pnpm
- Python environment with Rolling Pebble installed
- Tauri system dependencies for the target platform

macOS can build macOS apps. Windows should be built and tested on Windows.

## Development Run

```bash
pnpm -C frontend build
pnpm desktop:dev
```

If the backend package is not installed into the Python used by Tauri:

```bash
PYTHON="$PWD/.venv/bin/python" pnpm desktop:dev
```

## Build Python Sidecar

Install PyInstaller in the environment that has Rolling Pebble installed:

```bash
python -m pip install pyinstaller
python -m PyInstaller --name rollingpebble-backend --onefile --distpath desktop/bin --workpath build/pyinstaller --specpath build/pyinstaller desktop/rollingpebble_backend.py
```

On Windows, use:

```text
desktop/bin/rollingpebble-backend.exe
```

Then run the desktop app with:

```bash
ROLLINGPEBBLE_BACKEND="$PWD/desktop/bin/rollingpebble-backend" pnpm desktop:dev
```

## Bundle

Install the Tauri CLI:

```bash
cargo install tauri-cli --version "^2"
```

Build:

```bash
pnpm desktop:build
```

Expected outputs include:

- macOS: `.app` / `.dmg`
- Windows: `.msi` / NSIS installer

The Tauri config bundles `desktop/bin/rollingpebble-backend*` into the app resources under `bin/`, where the desktop shell can discover it automatically.

## Notes

This is a prototype packaging path. Before publishing desktop installers, test:

- backend startup and shutdown
- bundled frontend assets
- local file dialogs
- audio playback
- Auto Timing runtime creation
- model download paths
- Windows Defender behavior
- macOS signing and notarization
