# Release Checklist

Read the release version from `pyproject.toml`; current examples use `0.9.1`. Run commands from the repository root.

Publishing a GitHub Release triggers `.github/workflows/python-publish.yml` and
publishes Python distributions to PyPI through trusted publishing. Pushing the
commit/tag alone does not publish a GitHub Release or upload the DMG.

## Current Preparation

Version 0.9.1 adds shared macOS arm64/Linux x86_64/Windows x86_64 desktop packaging, a checksum-pinned Linux standalone Python, offline CPU engine resources and native package smoke checks. It also includes the workspace, recovery and UI refinements recorded in CHANGELOG. Build fresh 0.9.1 artifacts for release; checks against older installers do not validate the new release. Commit/tag pushes do not publish packages.

## Version and Checks

Keep `pyproject.toml`, root and frontend `package.json`, `src-tauri/Cargo.toml`,
`src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` in sync. Update `CHANGELOG.md` and the user setup notes.

```bash
pnpm -C frontend check:i18n:zh
pnpm -C frontend check:type
pnpm -C frontend check:lint
.venv/bin/python -m ruff check backend tests desktop
.venv/bin/python -m pytest -q
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
```

The Chinese i18n check is the release gate; the all-locale audit may report
historical untranslated non-Chinese strings.

Before publishing, also verify the [workspace and deletion flow](USER_GUIDE.md) using isolated data: opening audio creates no project, Save Project creates one complete project, Auto Timing saves once, and React confirmation cancellation/undo works in the actual native app.

## macOS DMG

Build on Apple Silicon with the tools described in [DESKTOP.md](DESKTOP.md):

```bash
pnpm desktop:build
codesign --verify --deep --strict "src-tauri/target/release/bundle/macos/Rolling Pebble.app"
hdiutil verify "src-tauri/target/release/bundle/dmg/Rolling Pebble_0.9.1_aarch64.dmg"
shasum -a 256 "src-tauri/target/release/bundle/dmg/Rolling Pebble_0.9.1_aarch64.dmg"
```

The build hook rebuilds the sidecar with standalone Python, includes app version
metadata, and audits embedded binaries. Never substitute a sidecar built with
the developer's system/Homebrew Python.

Mount the DMG read-only and confirm it contains the app and Applications link.
Check the bundled version and signature, then smoke-test startup and a real
alignment with an isolated data directory and a PATH without Homebrew. Confirm
completed + exit zero, alignment/LRC consistency and independent preview results. First-run acceptance also
requires automatic startup preparation/repair and explicit model download from empty
runtime/model directories. Check normal shutdown reaps the backend.

**Signing limitation:** this configuration uses ad-hoc signing, not Developer ID
signing or Apple notarization. Signature integrity is not proof of Gatekeeper
acceptance. Publish this limitation prominently; do not describe this artifact
as notarized or as requiring no first-launch approval. This is an arm64 build,
not a universal/Intel build. macOS 14 is the declared binary minimum, not proof
of dependency compatibility on every older OS version.

## Python Distributions

The GitHub workflow builds the frontend, copies it into Python package data,
then builds the wheel and sdist. To verify locally:

```bash
pnpm -C frontend build
rm -rf backend/rollingpebble/frontend_dist
mkdir -p backend/rollingpebble/frontend_dist
cp -R frontend/dist/. backend/rollingpebble/frontend_dist/
.venv/bin/python -m build
```

Expected files:

- `dist/rollingpebble-0.9.1-py3-none-any.whl`
- `dist/rollingpebble-0.9.1.tar.gz`

Verify these include the WebUI and current metadata, but not standalone Python,
virtual environments, or models. CLI/PyPI users need the bundled Python 3.12 and matching engine resources prepared from source for Auto
Timing; the Python package alone does not include an engine wheelhouse. The workflow checks that the release tag matches the package version.

## Push and Publish

After checks and artifact verification:

```bash
git tag -a v0.9.1 -m "Release v0.9.1"
git push --atomic origin main v0.9.1
```

After maintainer acceptance, manually publish the GitHub Release for `v0.9.1`
using the v0.9.1 changelog as release notes. Attach freshly built installers from
each platform's `dist/desktop/<platform>` directory: macOS arm64 DMG, Linux x86_64
`.deb` and AppImage, and Windows x64 NSIS `setup.exe`. Upload installation notes
under platform-specific names and combine the per-platform `SHA256SUMS` into one
release-level file (preserving the exact installer filenames) to avoid asset-name
collisions. Check every hash against the uploaded installer. Mention that Python, FFmpeg and binary dependencies are bundled, model weights are prepared separately in Settings, and Vocals needs Demucs. Then verify the PyPI
publishing workflow completes. Do not publish a Release merely to test CI.

## Remaining Public Distribution Gates

- Maintainer acceptance of language-based model preparation, mixed-language batches, cancellation and per-model repair. Real inference is left to the maintainer; small-file download tests do not establish real-song alignment quality.
- Maintainer acceptance of Preview editing, keyboard focus, Apply, batch review and narrow/wide window layout. Automated browser testing is intentionally omitted.
- Validate on the actual minimum supported macOS version; the current machine's success and Mach-O audit are not an OS matrix.
- Preserve the bundled FFmpeg LGPL license, corresponding source archive and build parameters; verify their hashes against the engine manifest.
- Preserve eSpeak NG GPL notices, corresponding source, pronunciation data and build parameters. Check relocated long Unicode paths with `desktop/validate_pronunciation.py` without Homebrew on PATH.
- Developer ID signing/notarization, if required for the intended distribution.
- Obtain explicit GitHub Release/PyPI publication instructions after artifact acceptance.

## Linux x86_64 local installers

Build on Ubuntu 24.04 with `pnpm desktop:build`. Check both exported installers in `dist/desktop/linux-x86_64` with `desktop/validate_linux_bundle.py`, inspect `.deb` dependencies, and verify `SHA256SUMS` before sharing. Preserve bundled third-party notices and sources. Native startup/offline component checks are separate from real model inference and interactive playback/editing acceptance. No upload or publication is triggered by this local build.

## Windows x86_64 local installer

Follow [Windows setup and validation](WINDOWS_X86_64.md), then run the shared
`pnpm desktop:build`. Validate the exported NSIS installer in
`dist/desktop/windows-x86_64` by installing it to a dedicated test location and
running `desktop/validate_windows_bundle.py` against that installed executable.
Preserve the hashed offline wheelhouse, third-party sources and notices. Verify
the exported SHA-256 checksum. The local build is unsigned; model inference,
interactive playback/editing and signing remain separate acceptance gates.
