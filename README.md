# rollingpebble

Local WebUI for lyrics lookup, automatic timing, manual LRC editing, export, and LRCLIB publishing.

Rolling Pebble runs locally. The browser UI talks to a local FastAPI backend, and Auto Timing uses an isolated `py-roller` runtime so heavy audio dependencies stay separate from the main app environment.

Current highlights:

- Import audio files and lyrics from local files, LRCLIB, and supported online sources.
- Edit and synchronize LRC lyrics manually.
- Run Auto Timing through `py-roller` with isolated runtime profiles.
- Manage projects, model caches, runtime environments, storage locations, and cleanup.
- Publish prepared lyrics through LRCLIB workflows.
- Use the UI in multiple languages through the built-in i18n layer.

Default ports:

- Backend/API: `http://127.0.0.1:6789`
- Vite frontend in development: `http://127.0.0.1:5173`

## Clean development setup

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -U pip setuptools wheel
python -m pip install -e .
pnpm install
```

Start both backend and frontend with one command:

```bash
. .venv/bin/activate
rollingpebble dev
```

Then open:

```text
http://127.0.0.1:5173
```

You can still run two terminals if preferred:

```bash
# terminal 1
. .venv/bin/activate
rollingpebble serve --reload

# terminal 2
pnpm dev
```

## Auto Timing runtime setup

The main workflow calls this feature **Auto Timing**. The technical engine is `py-roller`.

rollingpebble runs py-roller from an **isolated runtime virtual environment** under the rollingpebble data directory instead of installing or repairing py-roller inside the backend `.venv`. This keeps FastAPI/pylrclib separate from heavy audio dependencies such as Torch, Demucs, and faster-whisper.

Open **Settings -> Auto Timing -> Runtime** and choose:

- **Create Runtime** to create or repair the isolated py-roller runtime for the selected profile.
- **Runtime Check** to run `py-roller doctor` inside that isolated runtime.
- **Upgrade py-roller** to upgrade the isolated runtime package within Rolling Pebble's supported range.

The runtime is created under a path similar to:

```text
~/.local/share/rollingpebble/envs/pyroller-py312-cpu/.venv
```

Model files are stored separately from the runtime, for example:

```text
~/.local/share/rollingpebble/models/transcriber
```

This means the runtime can be repaired or recreated without deleting multi-gigabyte model caches.

For py-roller development, point rollingpebble at a local py-roller checkout before creating the runtime:

```bash
export LRC_ROLLER_PYROLLER_SOURCE=/path/to/py-roller
```

Then use **Create / Repair Runtime** from Settings.

When using the default PyPI source, runtime creation and upgrade install py-roller within the compatible runtime range declared by rollingpebble. The current requirement is `py-roller>=0.6.2,<0.8`.

After a model has been downloaded, enable local cache-only model use in Settings or Auto Timing to avoid unnecessary Hugging Face network access. For restricted networks, prefer `socks5h://` proxies so DNS resolution also goes through the SOCKS proxy.

## Production-like local server

Build the frontend and serve everything from the backend port:

```bash
pnpm build
rollingpebble
```

Then open:

```text
http://127.0.0.1:6789
```

## GitHub release build

For a GitHub Release asset, build the frontend, copy it into the Python package data directory, then build the Python distributions:

```bash
pnpm -C frontend build
rm -rf backend/rollingpebble/frontend_dist
mkdir -p backend/rollingpebble/frontend_dist
cp -R frontend/dist/. backend/rollingpebble/frontend_dist/
python -m build
```

Upload the generated files from `dist/` to the GitHub Release. The source checkout can still serve `frontend/dist` directly during local testing, but wheels should include `backend/rollingpebble/frontend_dist`.
