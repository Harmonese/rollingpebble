# Desktop Packaging

Rolling Pebble can be packaged as a lightweight Tauri desktop app while keeping the existing React frontend and Python backend.

The desktop shell does not replace the backend. It starts a local Rolling Pebble server on a random `127.0.0.1` port, then opens a native WebView window pointed at that server.

## Supported targets

The shared build entry supports **macOS Apple Silicon**, **Linux x86_64** and **Windows x86_64**.
Linux is built and validated on Ubuntu 24.04; `.deb` and AppImage outputs do not establish support for every Linux distribution or older glibc baseline. Windows targets Windows 10 version 1903+ / Windows 11 x64 with WebView2. Other architectures require separate resource recipes and native validation.

`desktop/platforms.json` selects the checksum-pinned standalone Python and Torch variant. Each platform has its own engine lock; shared scripts build the backend and native components. Build on the target OS/architecture rather than cross-compiling the Python/audio stack.

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
- Bundle platform-specific standalone Python 3.12, FFmpeg and a hashed binary engine wheelhouse so runtime installation needs no compiler, Homebrew or network.

## Requirements

- Rust toolchain: <https://rustup.rs>
- Node.js and pnpm
- Python environment with Rolling Pebble installed
- Tauri system dependencies for the target platform

The release hook selects macOS arm64, Linux x86_64 or Windows x86_64 from the host. Intel macOS and other architectures are not configured.

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

The Tauri CLI is pinned in the root pnpm lockfile and installed by `pnpm install`; a global Cargo CLI installation is unnecessary.

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
- Linux x86_64: `.deb` / `.AppImage`

The shared entry exports installers, `README.txt` and `SHA256SUMS` to
`dist/desktop/<platform>/`. The local `CARGO_TARGET_DIR` may place intermediate
artifacts elsewhere; exported installer paths remain stable.

The Tauri config bundles `desktop/bin/rollingpebble-backend*` into the app resources under `bin/`, where the desktop shell can discover it automatically.
The build also downloads pinned Python 3.12 into `desktop/python-runtime/` and bundles it under `python-runtime/`. `desktop/engine/` contains the wheelhouse, hashed requirements, FFmpeg and license notices. Both are generated and ignored by Git.

`desktop/prepare_engine.py` builds py-roller 0.10.3 from commit `6d3ded2537c7a6d6b444c18571581d6919dea409`, not from an installed development environment. It obtains the source under ignored `build/py-roller-source`, or uses `ROLLINGPEBBLE_ENGINE_SOURCE`. Native neural dependencies must have compatible binary wheels. Source-only pure Python dependencies are built on the build machine. `desktop/engine-macos-arm64.lock` pins dependency versions/hashes. Changing dependencies requires an explicit lock update and another native audit. Demucs 4.1.0 is required for the upstream `--clip-mode none` command. `desktop/prepare_ffmpeg.py` builds FFmpeg 7.1 from a checksum-pinned source archive using Xcode on the build machine; its source, license and build flags accompany the executable.

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

The standalone FFmpeg build disables GPL/nonfree components, optional external libraries and network protocols. Its LGPL license, complete corresponding source and build configuration are included under `engine/bin`; preserve these in distributions. It decodes local audio and emits PCM/FLAC for the engine. See [release gates](RELEASE.md).

`desktop/prepare_espeak.py` builds pinned eSpeak NG 1.52.0 and pronunciation data for mul. The engine bundle includes its GPL and data notices, source archive and build flags separately from FFmpeg. The build increases `N_PATH_HOME` to 4096 to support long application/resource paths. It has no Homebrew dynamic-library dependency; packaging validation must exercise phonemization after relocating the components with PATH restricted to system tools.

For non-GUI acceptance of the lean runtime, run
`build/python-build-runtime/bin/python3.12 -B desktop/validate_runtime_distribution.py`.
It uses temporary home/cache/venv directories, checks relocated SSL and pip, installs
the hashed wheelhouse offline including Vocals, and checks English/Mandarin/multilingual
components and relocated pronunciation without downloading models or running inference.
The Tauri/Rust configuration and symbol settings are unchanged by this optimization.

## Linux x86_64

See [Linux setup and validation](LINUX_X86_64.md) for the Ubuntu dependency list and validation commands.
The same `pnpm desktop:build` command selects Linux resources, builds the PyInstaller sidecar with standalone Python 3.12.15, and packages the Tauri app.

The Linux engine lock uses Torch/Torchaudio 2.8.0+cpu. FFmpeg and eSpeak are built from the same checksum-pinned sources as macOS using Linux compiler flags. ELF architecture and developer library paths are audited in place of Mach-O deployment targets. Model weights are not included and require an explicit download in the app.

Tauri's resource directory resolves installed Linux paths and extracted AppImage layouts. Release startup requires bundled resources and runs the packaged backend/WebUI rather than falling back to a source checkout or system Python. `.deb` declares GTK/WebKit, OpenMP and audio codec dependencies; AppImage additionally bundles the media framework. Neither format removes the need to validate the host Linux system libraries.

Before sharing an installer, extract it and exercise its actual native window with a fresh data directory and PATH restricted to system tools:

```bash
.venv/bin/python desktop/validate_linux_bundle.py --deb "dist/desktop/linux-x86_64/Rolling Pebble_0.9.1_amd64.deb" --log-dir output/linux-x86_64/deb-smoke
.venv/bin/python desktop/validate_linux_bundle.py --appimage "dist/desktop/linux-x86_64/Rolling Pebble_0.9.1_amd64.AppImage" --log-dir output/linux-x86_64/appimage-smoke
```

The test needs Xvfb (`--xvfb /path/to/Xvfb`), xwininfo and dbus-run-session. It verifies startup-triggered offline preparation, HTTP assets, a real native window and backend cleanup on window close. It does not download models or substitute for real-song alignment and interactive editing/playback acceptance.

## Windows x86_64

See [Windows setup and validation](WINDOWS_X86_64.md). The shared
`pnpm desktop:build` entry selects Windows resources and exports a per-user NSIS
installer. Windows has its own Python checksum and CPU engine lock. Native PE
audits, offline relocated component checks and an installed-app smoke test cover
the platform-specific runtime layout and backend process cleanup.
