# macOS Desktop Packaging

Rolling Pebble can be packaged as a lightweight Tauri desktop app while keeping the existing React frontend and Python backend.

The desktop shell does not replace the backend. It starts a local Rolling Pebble server on a random `127.0.0.1` port, then opens a native WebView window pointed at that server.

## Supported targets

The maintained release preparation currently supports **macOS Apple Silicon only**. Linux, Windows and Intel macOS need platform-specific standalone Python selection, resource discovery, build hooks and native validation. Tauri support alone does not establish support for the bundled Python/audio dependency stack. Build PyInstaller sidecars on each target OS.

Run the commands below from the repository root. [Development](DEVELOPMENT.md) covers the shared setup; [Release checklist](RELEASE.md) covers publication.

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
- Bundle standalone macOS arm64 Python 3.12, FFmpeg and a hashed binary engine wheelhouse so runtime installation needs no compiler, Homebrew or network.

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

The macOS arm64 build hook uses `desktop/build.mjs` to select a working Python 3.12+ with SSL (override with `ROLLINGPEBBLE_BUILD_PYTHON`).
The script downloads the standalone Python runtime and creates
`build/desktop-build-venv` from that interpreter for PyInstaller and app dependencies.
The complete build interpreter is cached under `build/python-build-runtime`.
After building the sidecar, a separate distribution is staged into
`desktop/python-runtime`. Only the real `bin/python3.12` is distributed: verified
`python`/`python3` aliases are omitted so Tauri resource copying cannot expand them
into three full executables. Bytecode caches with corresponding Python source are
excluded; sourceless bytecode, pip/ensurepip, venv, SSL, Tcl/Tk, engine dependencies
and license/source materials remain. Validation uses `-B` to avoid recreating caches
in the staged distribution. Runtime execution may create new caches in user app data;
existing user installations are not pruned.
The developer's Homebrew/system Python is not used as the sidecar interpreter.
The sidecar is rebuilt from the current backend and `frontend/dist` on every
release build; an old `desktop/bin` sidecar is never reused. The build audits
embedded arm64 binaries for incompatible deployment targets and absolute
non-system library dependencies before bundling the app.

Expected outputs include:

- macOS: `.app` / `.dmg`

The Tauri config bundles `desktop/bin/rollingpebble-backend*` into the app resources under `bin/`, where the desktop shell can discover it automatically.
The build also downloads pinned Python 3.12 into `desktop/python-runtime/` and bundles it under `python-runtime/`. `desktop/engine/` contains the wheelhouse, hashed requirements, FFmpeg and license notices. Both are generated and ignored by Git.

`desktop/prepare_engine.py` builds py-roller 0.10.3 from the adjacent repository's commit `6d3ded2`, not from an installed development environment. Native neural dependencies must have compatible binary wheels. Source-only pure Python dependencies are built on the build machine. `desktop/engine-macos-arm64.lock` pins dependency versions/hashes. Changing dependencies requires an explicit lock update and another native audit. Demucs 4.1.0 is required for the upstream `--clip-mode none` command. `desktop/prepare_ffmpeg.py` builds FFmpeg 7.1 from a checksum-pinned source archive using Xcode on the build machine; its source, license and build flags accompany the executable.

## Notes

The intended macOS arm64 user setup is to drag the app into `/Applications`,
let startup prepare components, then choose whether to download shared models and the selected language CTCs.
Settings retains individual download, verification and repair controls.
The bundled interpreter is copied into the user data directory's
`runtime/python`; dependencies are installed into `runtime/venv`, and models are
stored separately. Model downloads need network access but runtime installation must not require Homebrew,
a system Python, developer source checkouts, or preexisting model caches.
Restricted networks may require a proxy configured in the app's model-download
settings. The proxy is a network-access requirement, not a Python prerequisite.
The binary lock pins PyAV 16.1.0 and Torch/Torchaudio 2.8.0. Installation and repair use the same offline manifest. Vocals dependencies prepare automatically; Demucs weights are downloaded explicitly.

The current macOS configuration uses ad-hoc signing. A successful
`codesign --verify --deep --strict` check verifies bundle integrity, not Apple
notarization or a frictionless first launch of a quarantined download.
Developer ID signing and notarization remain separate release gates.

Validate the actual release app with an empty user data directory and a PATH
without developer tools. Confirm the install report uses the copied bundled
Python, then complete model download and a real alignment through the app.
Unit tests alone do not establish that first-run setup works.
The app declares macOS 14 or newer based on the complete binary dependency audit,
not just the bundled interpreter. Validate dependency installation on each supported
macOS version before release; a successful install on the build machine alone
does not establish compatibility with older systems.

Before publishing desktop installers, test:

- backend startup and shutdown
- bundled frontend assets
- local file dialogs
- audio playback
- automatic component preparation and repair
- model download paths
- macOS signing and notarization

The standalone FFmpeg build disables GPL/nonfree components, optional external libraries and network protocols. Its LGPL license, complete corresponding source and build configuration are included under `engine/bin`; preserve these in distributions. It decodes local audio and emits PCM/FLAC for the engine. See [release gates](RELEASE.md) and [validation record](AUTO_TIMING_VALIDATION.md).

`desktop/prepare_espeak.py` builds pinned eSpeak NG 1.52.0 and pronunciation data for mul. The engine bundle includes its GPL and data notices, source archive and build flags separately from FFmpeg. The build increases `N_PATH_HOME` to 4096 to support long application/resource paths. It has no Homebrew dynamic-library dependency; packaging validation must exercise phonemization after relocating the components with PATH restricted to system tools.

For non-GUI acceptance of the lean runtime, run
`build/python-build-runtime/bin/python3.12 -B desktop/validate_runtime_distribution.py`.
It uses temporary home/cache/venv directories, checks relocated SSL and pip, installs
the hashed wheelhouse offline including Vocals, and checks English/Mandarin/multilingual
components and relocated pronunciation without downloading models or running inference.
The Tauri/Rust configuration and symbol settings are unchanged by this optimization.
