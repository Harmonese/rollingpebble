# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

rollingpebble is a local WebUI for lyrics lookup, automatic timing (Auto Timing), manual LRC editing, and LRCLIB publishing. Backend: FastAPI on `127.0.0.1:6789`. Frontend: React 18 + Vite on `127.0.0.1:5173` (dev) or served from FastAPI (production).

## Commands

```bash
# Full dev stack (backend + Vite frontend)
rollingpebble dev

# Individual dev terminals
rollingpebble serve --reload       # backend with auto-reload
pnpm dev                        # frontend Vite dev server (from repo root)
pnpm -C frontend start          # same, from any directory

# Production-like (build frontend, serve from backend port)
pnpm build && rollingpebble

# Python tests
python -m pytest                # all tests
python -m pytest tests/test_lrc_roller_runtime_and_app.py -k test_runtime_install_blocks
python -m pytest tests/test_pyroller_adapter.py

# Frontend checks (run from repo root)
pnpm -C frontend check:type     # TypeScript type-check (tsc -b --noEmit)
pnpm -C frontend check:lint     # oxlint correctness checks
pnpm -C frontend check:fmt      # dprint formatting check
pnpm -C frontend fix:fmt        # dprint auto-format

# Backend checks
ruff check backend/             # Python linting (line-length 100, target py310)

# Diagnostics
rollingpebble doctor
rollingpebble doctor --run-pyroller-doctor

# Setup isolated runtime
rollingpebble setup --profile auto
```

## Architecture

### Backend (`backend/`)

Python package `rollingpebble` installed from the monorepo root with `pip install -e .`.

- `main.py` — `create_app()` factory builds the FastAPI app with all routes registered inline. Frontend SPA fallback is served after API routes when built assets exist.
- `cli.py` — Entry point (`rollingpebble` console script). Subcommands: `serve`, `dev`, `setup`, `doctor`. Dev mode spawns uvicorn and `pnpm -C frontend start` as subprocesses. `setup` can run `runtime_installer.py` as a standalone subprocess.
- `models.py` — Pydantic models for all API requests/responses. `RollRequest` carries all Auto Timing options (splitter, transcriber, aligner, writer, etc.).
- `jobs.py` — `JobManager` runs long-running commands (Auto Timing, runtime install/doctor) as threaded subprocesses. Progress is parsed from stdout via `pyroller.progress` log lines, JSONL events (`PYROLLER_EVENT ` prefix), and tqdm download bars. Job status is polled by the frontend via `/api/jobs/{job_id}`.
- `config.py` — `Settings` dataclass resolved from env vars (`LRC_ROLLER_HOST`, `LRC_ROLLER_PORT`, `LRC_ROLLER_DATA_DIR`, `LRC_ROLLER_FRONTEND_DIST`). Frontend asset resolution order: explicit env → bundled wheel `frontend_dist/` → source checkout `frontend/dist/`.
- `paths.py` — `ensure_data_dirs()` creates the data directory tree (`projects/`, `models/`, `envs/`, `cache/`) and returns path dicts.
- `runtime_constants.py` — Shared constants: `PYROLLER_RUNTIME_SPEC` (`py-roller>=0.6.0,<0.8`), support package specs, JSONL event prefix.
- `runtime_installer.py` — Creates/repairs the isolated py-roller venv. Can be invoked directly as `python -m rollingpebble.runtime_installer` (used by CLI `setup` and by `runtime_service.py` via `JobManager`).
- `version.py` — `app_version()` returns the installed package version.

**services/** — Business logic layer:
- `project_service.py` — Project CRUD: creates projects from audio uploads, manages lyrics files, applies editor saves.
- `roller_service.py` — Merges user request with saved settings (`_effective_request()`), builds the py-roller CLI command, and submits jobs. Handles both single-project and batch rolling.
- `runtime_service.py` — API-facing runtime operations (install, upgrade, doctor, cache-model). Delegates to `runtime_manager.py` and submits work via `JobManager`.
- `runtime_manager.py` — Low-level venv management: inspect, create, doctor, upgrade. Handles venv paths, `pip install` commands, and runtime environment variables.
- `lrclib_service.py` — LRCLIB search, get (with cache), and get-by-id.
- `netease_service.py` — NetEase Cloud Music song search, resolve (URL/ID parsing), and lyrics fetch with audio streaming.
- `upload_service.py` — LRCLIB publish workflow: plan (validate/diff) then run (upload lyrics records).
- `storage_service.py` — Disk usage reporting, model/runtime/other folder browsing, and cleanup (delete unused runtimes/models/cache).
- `local_dialog.py` — Native OS file/folder picker dialog wrapper used by the `/api/local/select-path` endpoint.

**adapters/**:
- `pyroller_adapter.py` — Builds the `py-roller run` command line from `RollRequest`. Defines the 6-stage pipeline: splitter (s), filter (f), transcriber (t), parser (p), aligner (a), writer (w).
- `pylrclib_adapter.py` — Checks pylrclib dependency status for health endpoint.

**storage/**:
- `app_settings.py` — `SettingsStore` persists `RuntimeSettingsModel` as JSON at `<data_dir>/settings.json`.
- `files.py` — Constants for known filenames.

### Frontend (`frontend/`)

React 18 SPA, forked from `lrc-maker`. Uses `@lrc-maker/lrc-parser` for lyrics parsing and `wavesurfer.js` for waveform display.

- Three-panel layout: left (Project + Lyrics Import), center (lrc-maker Synchronizer/Editor), right (Auto Timing + Upload). Settings and About are overlay panels.
- `src/shared/api.ts` — Typed fetch wrapper for all backend endpoints. Uses `#const/*` path alias (maps to `src/const/`).
- `src/features/` — Feature panels: `RollerPanel.tsx` (Auto Timing), `SettingsPanel.tsx`, `UploadPanel.tsx`, `ProjectPanel.tsx`, `LrclibPanel.tsx`, `AboutPanel.tsx`.
- `src/components/` — Shared UI: `app.tsx`, `editor.tsx`, `synchronizer.tsx`, `audio.tsx`, `waveform.tsx`, `header.tsx`, `footer.tsx`, `toast.tsx`.
- `src/hooks/` — `useLrc.ts`, `useKeyBindings.ts`, `usePref.ts`, `useLang.ts`.
- `src/languages/` — i18n JSON files (zh-CN, zh-HK, zh-TW, ja, ko-KR, en-US, pl-PL, pt-BR, sk-SK).
- `src/const/` — App constants: router paths, session keys, local storage keys, gist info, links.
- `workers/` — Web Workers for audio decryption (NetEase Cloud Music `ncmc-worker.ts`, QQ Music `qmc-worker.ts`).
- Vite config proxies `/api` to `http://127.0.0.1:6789` in dev. Build output goes to `frontend/dist/`.

### Key concepts

- **Auto Timing** is the user-facing feature name; **py-roller** is the technical engine invoked as a subprocess.
- The py-roller runtime runs in an **isolated venv** under `<data_dir>/envs/pyroller-py<ver>-<profile>/.venv`. Models are stored separately under `<data_dir>/models/`.
- The py-roller version spec is `py-roller>=0.6.0,<0.8` (see `runtime_constants.py`). The README may be out of date.
- The six-stage pipeline (`s,f,t,p,a,w`) must be a continuous subsequence. Only options relevant to the selected stages are passed to the CLI.
- `RuntimeSettingsModel` (saved as `settings.json`) holds defaults for all Auto Timing parameters. `RollerService._effective_request()` merges them with each request.
- Data directory structure: `projects/`, `models/`, `envs/`, `cache/`, `settings.json`.
- The UI has no routing library — a single page app with conditional panel visibility.
- The `runtime_installer.py` module runs both as a standalone script (via CLI `setup`) and as a job-managed subprocess (via `runtime_service.py`).
- Frontend dev server on 5173 proxies API calls to the backend on 6789. Production builds are served directly from FastAPI with SPA fallback.
