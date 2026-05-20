# Release Checklist

This project releases through GitHub Releases. Publishing a GitHub Release triggers the PyPI publishing workflow.

## Version

Current release target: `v0.6.1`

Before tagging:

1. Confirm `pyproject.toml` has the target version.
2. Update `CHANGELOG.md`.
3. Run the frontend and backend checks.
4. Create and push the git tag.
5. Publish the GitHub Release.
6. Confirm the PyPI workflow succeeds.

## Verify

```bash
pnpm -C frontend check:type
pnpm -C frontend check:lint
pnpm -C frontend build
python -m compileall backend/rollingpebble
```

If backend tests are added, run them before tagging.

## Build Artifacts

The GitHub Actions workflow builds release artifacts automatically. It must build the frontend first and copy it into the Python package data directory before running `python -m build`.

For a local release build or smoke test, use:

```bash
pnpm -C frontend build
rm -rf backend/rollingpebble/frontend_dist
mkdir -p backend/rollingpebble/frontend_dist
cp -R frontend/dist/. backend/rollingpebble/frontend_dist/
python -m build
```

Expected files in `dist/`:

- `rollingpebble-0.6.1-py3-none-any.whl`
- `rollingpebble-0.6.1.tar.gz`

## PyPI Publishing

Publishing a GitHub Release runs `.github/workflows/publish-to-pypi.yml`.

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
python -m pip install dist/rollingpebble-0.6.1-py3-none-any.whl
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
git tag -a v0.6.1 -m "Release v0.6.1"
git push origin main
git push origin v0.6.1
```

## GitHub Release Notes

Title:

```text
Rolling Pebble v0.6.1
```

Body:

```markdown
Maintenance release for Rolling Pebble.

Highlights:

- Converted `CHANGELOG.md` to a Keep a Changelog style structure.
- Added GitHub Actions publishing to PyPI when a GitHub Release is published.
- The release workflow builds the frontend and includes it in the Python wheel before publishing.

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
- Auto Timing creates an isolated py-roller runtime under the Rolling Pebble data directory.
- Large model downloads are managed separately from runtime environments.
```
