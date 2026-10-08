# macOS Desktop Packaging

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

Release build:

- Build the frontend.
- Build a platform-specific Python sidecar with PyInstaller.
- Bundle that sidecar into the Tauri app.
- Bundle a standalone macOS arm64 Python 3.12 runtime so end users do not need Python installed.

## Requirements

- Rust toolchain: <https://rustup.rs>
- Node.js and pnpm
- Python environment with Rolling Pebble installed
- Tauri system dependencies for the target platform

The current release hook targets macOS Apple Silicon only. Windows and Intel
macOS packaging are not provided by this hook.

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

Prepare a Python 3.12 build-script environment once:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
```

Build the sidecar from the pinned standalone interpreter, never directly from
the developer's Homebrew/system Python:

```bash
pnpm -C frontend build
.venv/bin/python desktop/build_resources.py
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

The macOS arm64 build hook uses `.venv/bin/python` to run the preparation script.
The script downloads the standalone Python runtime and creates
`build/desktop-venv` from that interpreter for PyInstaller and app dependencies.
The developer's Homebrew/system Python is not used as the sidecar interpreter.
The sidecar is rebuilt from the current backend and `frontend/dist` on every
release build; an old `desktop/bin` sidecar is never reused. The build audits
embedded arm64 binaries for incompatible deployment targets and absolute
non-system library dependencies before bundling the app.

Expected outputs include:

- macOS: `.app` / `.dmg`

The Tauri config bundles `desktop/bin/rollingpebble-backend*` into the app resources under `bin/`, where the desktop shell can discover it automatically.
The build also downloads a pinned Python 3.12 runtime into `desktop/python-runtime/` and bundles it under `python-runtime/`. This generated directory is ignored by Git.

## Notes

The intended macOS arm64 user setup is to drag the app into `/Applications`,
install the runtime in Settings, and download the selected model in Settings.
The bundled interpreter is copied into the user data directory's
`toolchains/python3.12`; dependencies are installed into `envs`, and models are
stored separately. Setup needs network access but must not require Homebrew,
a system Python, developer source checkouts, or preexisting model caches.
Restricted networks may require a proxy configured in the app's model-download
settings. The proxy is a network-access requirement, not a Python prerequisite.
The runtime recipe constrains PyAV to `>=11,<19` for faster-whisper compatibility;
this constraint applies to installation, repair, and package upgrades.

The current macOS configuration uses ad-hoc signing. A successful
`codesign --verify --deep --strict` check verifies bundle integrity, not Apple
notarization or a frictionless first launch of a quarantined download.
Developer ID signing and notarization remain separate release gates.

Validate the actual release app with an empty user data directory and a PATH
without developer tools. Confirm the install report uses the copied bundled
Python, then complete model download and a real alignment through the app.
Unit tests alone do not establish that first-run setup works.
The bundled arm64 Python requires macOS 11 or newer, matching the app's declared
minimum system version. Validate dependency installation on each supported
macOS version before release; a successful install on the build machine alone
does not establish compatibility with older systems.

Before publishing desktop installers, test:

- backend startup and shutdown
- bundled frontend assets
- local file dialogs
- audio playback
- Auto Timing runtime creation
- model download paths
- macOS signing and notarization
