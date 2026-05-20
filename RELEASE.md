# Release Checklist

This project currently releases through GitHub Releases. A PyPI release can be added later after the install flow has been tested more broadly.

## Version

Current release target: `v0.6.0`

Before tagging:

1. Confirm `pyproject.toml` has the target version.
2. Update `CHANGELOG.md`.
3. Run the frontend and backend checks.
4. Build release artifacts.
5. Create and push the git tag.

## Verify

```bash
pnpm -C frontend check:type
pnpm -C frontend check:lint
pnpm -C frontend build
python -m compileall backend/rollingpebble
```

If backend tests are added, run them before tagging.

## Build Artifacts

The Python wheel should include the built frontend. Build it like this:

```bash
pnpm -C frontend build
rm -rf backend/rollingpebble/frontend_dist
mkdir -p backend/rollingpebble/frontend_dist
cp -R frontend/dist/. backend/rollingpebble/frontend_dist/
python -m build
```

Upload these files from `dist/` to the GitHub Release:

- `rollingpebble-0.6.0-py3-none-any.whl`
- `rollingpebble-0.6.0.tar.gz`

## Smoke Test Wheel

```bash
python -m venv /tmp/rollingpebble-release-test
. /tmp/rollingpebble-release-test/bin/activate
python -m pip install -U pip
python -m pip install dist/rollingpebble-0.6.0-py3-none-any.whl
rollingpebble --help
rollingpebble doctor
```

For a UI smoke test:

```bash
rollingpebble serve --port 6790
```

Open `http://127.0.0.1:6790`.

## Tag

```bash
git tag -a v0.6.0 -m "Release v0.6.0"
git push origin main
git push origin v0.6.0
```

## GitHub Release Notes

Title:

```text
Rolling Pebble v0.6.0
```

Body:

```markdown
First formal GitHub release for Rolling Pebble.

Highlights:

- Local lyrics workflow: import, edit, synchronize, Auto Timing, export, and LRCLIB publishing.
- Isolated Auto Timing runtime with `py-roller>=0.6.2,<0.8`.
- Storage & Cleanup panel with project/model/runtime usage, cleanup actions, local migration controls, and project auto-delete settings.
- Expanded i18n coverage for frontend and backend-originated user messages.
- Improved project deletion/restore behavior and project ordering UI.
- Polished Settings, About, LRC Utilities, Synchronizer & Editor, Auto Timing, and Storage UI consistency.
- Improved operation messages, toasts, modal animations, and audio/background behavior.

Install from the attached wheel:

```bash
python -m pip install rollingpebble-0.6.0-py3-none-any.whl
rollingpebble
```

Then open:

```text
http://127.0.0.1:6789
```

Notes:

- Auto Timing creates an isolated py-roller runtime under the Rolling Pebble data directory.
- Large model downloads are managed separately from runtime environments.
- This release is distributed through GitHub Releases first; PyPI distribution may follow after more install testing.
```
