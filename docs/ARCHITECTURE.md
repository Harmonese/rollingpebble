# rollingpebble architecture

## Goal

A local web application for lyrics lookup, automatic timing, manual editing, and LRCLIB publishing. The main workflow uses user-facing names such as **Lyrics Import** and **Auto Timing**. Technical engine names are reserved for Settings, command previews, logs, and diagnostics.

## Runtime

- Backend: FastAPI on `127.0.0.1:6789` by default.
- Frontend: React/Vite, based on `lrc-maker`, served by Vite in development or by FastAPI from built static assets in production.
- Data directory: `~/.local/share/rollingpebble` by default, or `LRC_ROLLER_DATA_DIR` / `--data-dir`.
- Auto Timing runtime: an isolated per-profile virtual environment under the data directory, not the user's global `py-roller` installation.

## Frontend asset resolution

`create_app()` resolves static frontend assets in this order:

1. `LRC_ROLLER_FRONTEND_DIST` / explicit settings.
2. Bundled wheel assets at `rollingpebble/frontend_dist`.
3. Source-checkout assets at `frontend/dist`.

This keeps source development (`pnpm build && rollingpebble`) and packaged releases compatible. Release packaging should copy `frontend/dist` to `backend/rollingpebble/frontend_dist` before building the Python distribution.

## Backend shape

`rollingpebble.main.create_app()` is the composition root. It creates the shared service instances, wires storage-layout updates between services, includes domain routers from `rollingpebble.api`, and finally mounts the frontend SPA fallback when built assets are available.

API handlers live in domain router modules:

- `api/health.py`
- `api/projects.py`
- `api/lyrics_sources.py`
- `api/roller.py`
- `api/jobs.py`
- `api/settings.py`
- `api/runtime.py`
- `api/upload.py`
- `api/storage.py`

The router layer translates HTTP concerns into service calls. Business rules stay in `services/`, shared job-kind strings live in `job_kinds.py`, and storage roots are coordinated through a single `StorageLayoutRef`.

Long-running work is split into focused job modules:

- `jobs.py` exposes the public `JobManager` API.
- `jobs_store.py` owns in-memory job retention and lookup.
- `jobs_runner.py` owns subprocess lifecycle, cancellation, callbacks, and completion state.
- `jobs_progress.py` parses py-roller protocol v1 JSONL events.

Runtime management lives under `rollingpebble.runtime`:

- `runtime/manager.py` inspects runtimes and builds runtime commands.
- `runtime/service.py` exposes the runtime facade used by API routers.
- `runtime/settings.py` owns runtime settings read/update/reset behavior.
- `runtime/jobs.py` owns runtime job policy and subprocess submission.
- `runtime/results.py` owns doctor/install/upgrade/cache result persistence.
- `runtime/installer.py`, `runtime/dependencies.py`, `runtime/recipe.py`, `runtime/python.py`, `runtime/environment.py`, and `runtime/constants.py` hold the isolated-runtime implementation details.

Runtime code is imported directly from `rollingpebble.runtime`; older root-level `runtime_*` and `services/runtime_*` compatibility shims have been removed.

Storage is also split behind a stable `StorageService` facade:

- `services/storage_service.py` wires storage state and exposes the existing public API.
- `services/storage_usage.py` computes usage summaries and browsable project/model/runtime/other items.
- `services/storage_migration.py` moves configured storage roots and updates persisted settings.
- `services/storage_cleanup.py` builds cleanup plans, validates deletion boundaries, and applies deletions.
- `services/storage_shared.py` holds storage cleanup constants and cached-plan metadata.

The API layer receives an `AppServices` object from `api/context.py`. It is intentionally a composition boundary for already-built application services; routers do not create services themselves.

## Integration choices

### pylrclib

`pylrclib` is imported directly. The backend uses:

- `pylrclib.api.ApiClient`
- `pylrclib.models.TrackMeta`
- `pylrclib.models.LyricsBundle`
- `pylrclib.workflows.up.build_upload_plan`

This keeps search/get/upload-plan/upload structured and avoids parsing CLI output. Requests use an `rollingpebble/<version>` User-Agent so LRCLIB traffic can be traced during diagnostics.

### Auto Timing engine

The user-facing feature is **Auto Timing**. The technical engine is `py-roller`.

`py-roller` is invoked through the isolated runtime Python as a subprocess worker, for example:

```bash
/path/to/runtime/.venv/bin/python -m pyroller.cli.main run --request request.json --progress-format jsonl --output-format json
```

The command runs outside the FastAPI request path. Rolling Pebble talks to the engine through py-roller protocol v1 JSON request files, final JSON reports, and `PYROLLER_EVENT` JSONL progress events. Logs, structured progress, final reports, and cancel state are captured into an in-memory job object and exposed through `/api/jobs/{job_id}`. Runtime installation and doctor jobs are protected against concurrent install/check requests to avoid corrupting the isolated virtual environment.

## API summary

- Health: `GET /api/health`
- Projects: `POST /api/projects`, `GET /api/projects`, `GET /api/projects/{project_id}`, `GET /api/projects/{project_id}/audio`, `POST /api/projects/{project_id}/open-folder`, `POST /api/projects/{project_id}/lyrics`, `POST /api/projects/{project_id}/editor`, `DELETE /api/projects/{project_id}`
- Lyrics sources: `POST /api/lrclib/search`, `POST /api/lrclib/get`, `POST /api/lrclib/id`, `POST /api/netease/search`, `POST /api/netease/resolve`, `GET /api/netease/lyrics/{song_id}`, `GET /api/netease/audio/{song_id}`
- Auto Timing: `POST /api/projects/{project_id}/roll/preview`, `POST /api/projects/{project_id}/roll`, `POST /api/batch/preview`, `POST /api/batch/roll`
- Jobs: `GET /api/jobs/{job_id}`, `POST /api/jobs/{job_id}/cancel`, `POST /api/jobs/{job_id}/open-folder`
- Settings: `GET /api/settings`, `POST /api/settings`, `POST /api/settings/reset-defaults`, workspace background endpoints, and `POST /api/local/select-path`
- Runtime: `GET /api/runtime/auto-roller`, `POST /api/runtime/auto-roller/doctor`, `POST /api/runtime/auto-roller/install`, `POST /api/runtime/auto-roller/upgrade`, `POST /api/runtime/auto-roller/cache-model`
- Upload: `POST /api/projects/{project_id}/upload/plan`, `POST /api/projects/{project_id}/upload/run`
- Storage: usage, root migration, open-folder, and cleanup preview/run endpoints under `/api/storage`

## Frontend layout

```text
left:  Project + Lyrics Import
center: lrc-maker Synchronizer / Editor
right: Auto Timing + Upload
settings: Auto Timing Runtime / diagnostics / install profile
```

The center keeps lrc-maker's line-based editor, waveform/audio footer, shortcut system, and manual synchronization flow.

## Runtime commands

- `rollingpebble dev`: start backend and Vite frontend for development. CLI host/port/data-dir are forwarded to the uvicorn child process through environment variables.
- `rollingpebble serve`: start the local server, serving built frontend assets when available.
- `rollingpebble setup --profile auto`: run frontend install and create/repair the isolated `py-roller` runtime.
- `rollingpebble doctor`: inspect package, frontend, pylrclib, and isolated runtime status.
