# Release Checklist

This project releases through GitHub Releases. Publishing a GitHub Release triggers the PyPI publishing workflow.

## Version

Current release target: `v0.7.0`

Before tagging:

1. Confirm `pyproject.toml` has the target version.
2. Update `CHANGELOG.md`.
3. Run the frontend, backend, and packaging checks.
4. Create and push the git tag.
5. Publish the GitHub Release.
6. Confirm the PyPI workflow succeeds.

## Verify

```bash
pnpm -C frontend check:i18n:zh
pnpm -C frontend check:type
pnpm -C frontend check:lint
pnpm -C frontend build
.venv/bin/ruff check backend tests
.venv/bin/python -m pytest -q
```

`pnpm -C frontend check:i18n` audits every locale. It may report historical untranslated non-Chinese strings; `check:i18n:zh` is the release gate for the current Chinese UI path.

## Build Artifacts

The GitHub Actions workflow builds release artifacts automatically. It must build the frontend first and copy it into the Python package data directory before running `python -m build`.

For a local release build or smoke test, use:

```bash
pnpm -C frontend build
rm -rf backend/rollingpebble/frontend_dist
mkdir -p backend/rollingpebble/frontend_dist
cp -R frontend/dist/. backend/rollingpebble/frontend_dist/
.venv/bin/python -m build
```

Expected files in `dist/`:

- `rollingpebble-0.7.0-py3-none-any.whl`
- `rollingpebble-0.7.0.tar.gz`

## PyPI Publishing

Publishing a GitHub Release runs `.github/workflows/python-publish.yml`.

The workflow:

1. Checks that the release tag matches `pyproject.toml`.
2. Installs frontend dependencies with pnpm.
3. Builds the frontend.
4. Copies `frontend/dist` to `backend/rollingpebble/frontend_dist`.
5. Builds wheel and sdist.
6. Uploads the distributions as a GitHub Actions artifact.
7. Publishes the distributions to PyPI using trusted publishing.

PyPI must be configured with a trusted publisher for this repository and the `pypi` GitHub environment.

## Smoke Test Wheel

```bash
python -m venv /tmp/rollingpebble-release-test
. /tmp/rollingpebble-release-test/bin/activate
python -m pip install -U pip
python -m pip install dist/rollingpebble-0.7.0-py3-none-any.whl
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
git tag -a v0.7.0 -m "Release v0.7.0"
git push origin main
git push origin v0.7.0
```

## GitHub Release Notes

Title:

```text
Rolling Pebble v0.7.0
```

Body:

```markdown
Boundary cleanup and runtime stability release for Rolling Pebble.

Highlights:

- Cleaned up frontend boundaries across app, domain, features, ui, shared, and API modules.
- Cleaned up backend runtime, service, storage, adapter, and API boundaries and removed obsolete runtime shims.
- Hardened the py-roller protocol v1 integration with request/report contract tests.
- Raised the isolated Auto Timing runtime requirement to py-roller>=0.8.3,<0.9.
- Fixed isolated runtime repair for incomplete managed virtual environments.
- Improved localized runtime and Auto Timing progress messages, including runtime check success details.
- Added a Chinese i18n release gate for catching untranslated runtime/progress strings.

Install from PyPI:

```bash
python -m pip install rollingpebble
rollingpebble
```

Then open:

```text
http://127.0.0.1:6789
```

Notes:

- Auto Timing creates an isolated py-roller runtime under the Rolling Pebble data directory.
- Large model downloads are managed separately from runtime environments.
- The packaged WebUI is included in the Python wheel and source distribution.
```
