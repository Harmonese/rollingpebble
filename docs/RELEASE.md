# Release Checklist

Read the release version from `pyproject.toml`; current examples use `0.7.4`. Run commands from the repository root.

Publishing a GitHub Release triggers `.github/workflows/python-publish.yml` and
publishes Python distributions to PyPI through trusted publishing. Pushing the
commit/tag alone does not publish a GitHub Release or upload the DMG.

## 0.7.4 Preparation Status

- Automated checks: frontend types/lint/Chinese localization, lyric-mark and workspace-audio tests, 92 Python tests, Ruff, Rust formatting and compilation passed. Rust currently has no unit tests.
- Built macOS arm64 app/DMG and Python wheel/sdist. Verified app version, ad-hoc signature integrity, DMG checksum and app/Applications contents; Python packages include the WebUI and 0.7.4 metadata.
- DMG SHA-256: `c3abf40fa629ff4296994ba51258c4b2cb8ed169fea5b9119b07380b5cdc7e6f`.
- Native interactive acceptance, first-run runtime/model setup and real alignment remain manual checks. Local isolated UI testing was omitted at the maintainer's request.
- This preparation does not publish a GitHub Release, PyPI package or release tag.

## Version and Checks

Keep `pyproject.toml`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and
`src-tauri/tauri.conf.json` in sync. Update `CHANGELOG.md` and the user setup notes.

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
hdiutil verify "src-tauri/target/release/bundle/dmg/Rolling Pebble_0.7.4_aarch64.dmg"
shasum -a 256 "src-tauri/target/release/bundle/dmg/Rolling Pebble_0.7.4_aarch64.dmg"
```

The build hook rebuilds the sidecar with standalone Python, includes app version
metadata, and audits embedded binaries. Never substitute a sidecar built with
the developer's system/Homebrew Python.

Mount the DMG read-only and confirm it contains the app and Applications link.
Check the bundled version and signature, then smoke-test startup and a real
alignment with an isolated data directory and a PATH without Homebrew. Confirm
long run reports retain quality and artifact fields. First-run acceptance also
requires Settings runtime creation/repair and model download from empty
runtime/model directories. Check normal shutdown reaps the backend.

**Signing limitation:** this configuration uses ad-hoc signing, not Developer ID
signing or Apple notarization. Signature integrity is not proof of Gatekeeper
acceptance. Publish this limitation prominently; do not describe this artifact
as notarized or as requiring no first-launch approval. This is an arm64 build,
not a universal/Intel build. macOS 11 is the declared binary minimum, not proof
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

- `dist/rollingpebble-0.7.4-py3-none-any.whl`
- `dist/rollingpebble-0.7.4.tar.gz`

Verify these include the WebUI and current metadata, but not standalone Python,
virtual environments, or models. CLI/PyPI users still need Python 3.12 for Auto
Timing. The workflow checks that the release tag matches the package version.

## Push and Publish

After checks and artifact verification:

```bash
git tag -a v0.7.4 -m "Release v0.7.4"
git push --atomic origin main v0.7.4
```

Manually publish the GitHub Release for `v0.7.4`, attach
`Rolling Pebble_0.7.4_aarch64.dmg` and its SHA-256 checksum, and use the v0.7.4
changelog as release notes. Mention that only Python is bundled: dependencies
and models are downloaded through Settings, a proxy may be needed, and Full
processing may download Demucs separately on first use. Then verify the PyPI
publishing workflow completes. Do not publish a Release merely to test CI.
