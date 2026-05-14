# lrc-roller v0.5.5 architecture

## Goal

A local web application for lyrics lookup, automatic timing, manual editing, and LRCLIB publishing. The main workflow uses user-facing names such as **Lyrics Import** and **Auto Timing**. Technical engine names are reserved for Settings, command previews, logs, and diagnostics.

## Runtime

- Backend: FastAPI on `127.0.0.1:6789` by default.
- Frontend: React/Vite, based on `lrc-maker`, served by Vite in development or by FastAPI from built static assets in production.
- Data directory: `~/.local/share/lrc-roller` by default, or `LRC_ROLLER_DATA_DIR` / `--data-dir`.
- Auto Timing runtime: an isolated per-profile virtual environment under the data directory, not the user's global `py-roller` installation.

## Frontend asset resolution

`create_app()` resolves static frontend assets in this order:

1. `LRC_ROLLER_FRONTEND_DIST` / explicit settings.
2. Bundled wheel assets at `lrc_roller/frontend_dist`.
3. Source-checkout assets at `frontend/dist`.

This keeps source development (`pnpm build && lrc-roller`) and packaged releases compatible. Release packaging should copy `frontend/dist` to `backend/lrc_roller/frontend_dist` before building the Python distribution.

## Integration choices

### pylrclib

`pylrclib` is imported directly. The backend uses:

- `pylrclib.api.ApiClient`
- `pylrclib.models.TrackMeta`
- `pylrclib.models.LyricsBundle`
- `pylrclib.workflows.up.build_upload_plan`

This keeps search/get/upload-plan/upload structured and avoids parsing CLI output. Requests use an `lrc-roller/<version>` User-Agent so LRCLIB traffic can be traced during diagnostics.

### Auto Timing engine

The user-facing feature is **Auto Timing**. The technical engine is `py-roller`.

`py-roller` is invoked through the isolated runtime Python as a subprocess worker, for example:

```bash
/path/to/runtime/.venv/bin/python -m pyroller.cli.main run --stages t,p,a,w --audio audio.flac --lyrics plain.txt --output-roller pyroller_output.lrc --language zh
```

The command runs outside the FastAPI request path. Logs, JSONL progress events, and cancel state are captured into an in-memory job object and exposed through `/api/jobs/{job_id}`. Runtime installation and doctor jobs are protected against concurrent install/check requests to avoid corrupting the isolated virtual environment.

## API summary

- `GET /api/health`
- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/{project_id}`
- `GET /api/projects/{project_id}/audio`
- `POST /api/projects/{project_id}/lyrics`
- `POST /api/projects/{project_id}/editor`
- `POST /api/lrclib/search`
- `POST /api/lrclib/get`
- `POST /api/lrclib/id`
- `POST /api/lrc/cleanse`
- `POST /api/projects/{project_id}/roll/preview`
- `POST /api/projects/{project_id}/roll`
- `GET /api/jobs`
- `GET /api/jobs/{job_id}`
- `POST /api/jobs/{job_id}/cancel`
- `GET /api/settings`
- `POST /api/settings`
- `GET /api/runtime/auto-roller`
- `POST /api/runtime/auto-roller/settings`
- `POST /api/runtime/auto-roller/doctor`
- `POST /api/runtime/auto-roller/install`
- `POST /api/projects/{project_id}/upload/plan`
- `POST /api/projects/{project_id}/upload/run`

## Frontend layout

```text
left:  Project + Lyrics Import
center: lrc-maker Synchronizer / Editor
right: Auto Timing + Upload
settings: Auto Timing Runtime / diagnostics / install profile
```

The center keeps lrc-maker's line-based editor, waveform/audio footer, shortcut system, and manual synchronization flow.

## Runtime commands

- `lrc-roller dev`: start backend and Vite frontend for development. CLI host/port/data-dir are forwarded to the uvicorn child process through environment variables.
- `lrc-roller serve`: start the local server, serving built frontend assets when available.
- `lrc-roller setup --profile auto`: run frontend install and create/repair the isolated `py-roller` runtime.
- `lrc-roller doctor`: inspect package, frontend, pylrclib, and isolated runtime status.
