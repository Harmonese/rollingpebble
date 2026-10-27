# Windows x86_64 desktop

The Windows desktop uses the same Tauri, PyInstaller and offline engine resource
pipeline as macOS and Linux. Build on Windows x64, using the repository root as
the working directory. The output is a per-user NSIS installer; administrator
rights are not required to install the app.
NSIS uses zlib compression to keep rebuilds practical with the large, already
compressed offline wheelhouse.

## Build prerequisites

For this prepared checkout, open `scripts/windows-shell.cmd`, then run
`pnpm desktop:build` in the PowerShell session it opens. The launcher enables
the local setup script for that shell session, including on the default
Windows script-execution policy.

- Windows 10 version 1903 or newer / Windows 11 x64, Microsoft Edge WebView2.
- Node.js and pnpm 10.11.0 (the version in `package.json`).
- Rust MSVC x64 toolchain, including rustfmt.
- Visual Studio 2022 C++ tools and Windows SDK, or an equivalent portable MSVC
  toolchain with its SDK headers, libraries and resource compiler on the build
  environment's PATH. Set `DISTUTILS_USE_SDK=1` for a portable toolchain.
- Git for Windows POSIX shell tools and MSYS GNU Make for building FFmpeg.
- Python 3.12 with SSL to bootstrap `desktop/prepare_python_runtime.py`.
- CMake, Ninja, and pefile in the build environment.

`scripts/windows-env.ps1` imports an optional portable MSVC toolchain from
`build/tools/msvc/setup_x64.bat`, prepends the local Python development environment,
Rust, GNU Make and Git shell tools, and selects the standalone build interpreter.
It changes only the current PowerShell session. This checkout's portable tools
and downloaded archives are in ignored `build/`; no machine-wide PATH changes
are required.

```powershell
# Bootstrap with an existing Python 3.12, then use the pinned standalone Python.
python desktop/prepare_python_runtime.py
& ./build/python-build-runtime/python.exe -m venv .venv
& ./.venv/Scripts/python.exe -m pip install -e '.[dev]' cmake ninja pefile
. ./scripts/windows-env.ps1
pnpm install --frozen-lockfile
pnpm desktop:build
```

For source development after preparing the desktop resources:

```powershell
. ./scripts/windows-env.ps1
$env:ROLLINGPEBBLE_APP_RESOURCES = (Resolve-Path desktop).Path
rollingpebble dev
```

With a normal Visual Studio installation, first open its x64 developer shell.
The optional `build/tools/pnpm/pnpm.cmd` wrapper in this checkout selects the
repository's pnpm version when the host has a different version.
This checkout also includes portable Node.js and Git in `build/tools/node` and
`build/tools/git`; the environment script selects them before global tools.

## Distribution

Installers, `SHA256SUMS` and installation notes are exported to
`dist/desktop/windows-x86_64/`. The local installer is unsigned. WebView2's
bootstrapper downloads the runtime if it is missing; WebView2 installation then
requires network access.

The bundle includes checksum-pinned standalone CPython 3.12.15 for MSVC x64, a
PyInstaller backend built with that interpreter, a Windows-specific hashed CPU
wheelhouse, app-local Microsoft C++ release runtime DLLs, LGPL FFmpeg, and eSpeak NG 1.52.0 with pronunciation data. FFmpeg and
eSpeak are built from the same pinned sources as the other desktop platforms.
Their corresponding sources, notices and build parameters remain bundled.
The MSVC FFmpeg recipe disables the VVC video decoder to avoid an upstream 7.1
reference to unavailable AVX2 assembly when x86 assembly is disabled; audio
decoders and local audio conversion are retained.
The Windows Python distribution omits PDB debugging symbols, unused foreign
architecture pip launchers and redundant bytecode; the full build interpreter
is preserved separately. Its executable manifests opt into the process-local
UTF-8 code page so native pronunciation libraries can read Chinese and other
Unicode paths without changing Windows system locale. This requires the Windows
SDK manifest tool when preparing a Windows distribution.
The frozen backend also opts into UTF-8, and isolated Windows workers retain
the profile and AppData environment paths needed for first-run initialization.
Paths passed to eSpeak remove Windows verbatim (`\\?\`) prefixes, including
their UNC form: Tauri can return these prefixes for installed resources, but
eSpeak's native file APIs cannot open its pronunciation data with them.

The managed interpreter uses `python.exe` at its runtime root and the managed
venv uses `Scripts/python.exe`. Installation copies the complete interpreter
into the app's data directory before preparing components offline. Model weights
are downloaded separately through the app. The Windows engine lock is separate
from Linux and macOS; foreign wheel hashes must never be reused.

## Validation

Use a fresh data directory for each run. Do not point these commands at existing
projects, caches or application data.

```powershell
. ./scripts/windows-env.ps1
python -m ruff check backend tests desktop
python -m pytest -q
pnpm -C frontend check:type
pnpm -C frontend check:lint
pnpm -C frontend check:i18n:zh
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
python desktop/validate_runtime_distribution.py

# After installing the actual NSIS package into a dedicated test location:
python desktop/validate_windows_bundle.py --app '<installed executable>' --log-dir output/windows-x86_64/native-smoke
```

If Windows long-path support is disabled, add `--data-dir` with a short, unused
temporary directory; the smoke report still stays in `--log-dir`. The validator
refuses to reuse existing data and never deletes user projects or model caches.

The distribution check relocates Python, checks SSL/venv/pip, installs base and
Vocals dependencies from hashed wheels offline, and checks English, Mandarin and
multilingual components without downloading models or running inference.
The native check restricts PATH to Windows system tools, uses empty application
data and a separate WebView2 profile, waits for startup and multilingual preparation, verifies the
native window and packaged HTTP assets, then sends a normal window-close event
and checks backend cleanup. Reports remain in the requested log directory.

Tests that create symbolic links require Windows Developer Mode or the symlink
privilege. They explicitly skip only when that permission is unavailable.
Real-song inference, interactive editing/audio playback and code signing remain
separate release acceptance checks; local packaging does not publish a release.
