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
pnpm dev                        # frontend Vite dev server

# Production-like (build frontend, serve from backend port)
pnpm build && rollingpebble

# Python tests
python -m pytest                # all tests
python -m pytest tests/test_rollingpebble_runtime_and_app.py -k test_runtime_install_blocks

# Frontend checks (run from repo root or frontend/)
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

- `main.py` — `create_app()` factory builds the FastAPI app. All routes are registered inline. Frontend SPA fallback is served after API routes when built assets exist.
- `cli.py` — Entry point (`rollingpebble` console script). Subcommands: `serve`, `dev`, `setup`, `doctor`. Dev mode spawns both uvicorn and `pnpm -C frontend start` as subprocesses.
- `models.py` — Pydantic models for all API requests/responses. The RollRequest model carries all Auto Timing options (splitter, transcriber, aligner, writer, etc.).
- `jobs.py` — `JobManager` runs long-running commands (Auto Timing, runtime install/doctor) as threaded subprocesses. Progress is parsed from stdout via `pyroller.progress` log lines, JSONL events (`PYROLLER_EVENT ` prefix), and tqdm download bars. Job status is polled by the frontend via `/api/jobs/{job_id}`.
- `config.py` — `Settings` dataclass resolved from env vars (`LRC_ROLLER_HOST`, `LRC_ROLLER_PORT`, `LRC_ROLLER_DATA_DIR`, `LRC_ROLLER_FRONTEND_DIST`). Frontend asset resolution order: explicit env → bundled wheel `frontend_dist/` → source checkout `frontend/dist/`.
- `services/` — Business logic. `project_service.py` manages project directories and lyrics files. `roller_service.py` merges user request with saved settings, builds the py-roller CLI command, and submits jobs. `runtime_service.py` delegates to `runtime_manager.py` and `runtime_installer.py` for the isolated py-roller venv.
- `adapters/pyroller_adapter.py` — Builds the `py-roller run` command line from `RollRequest`. Defines the 6-stage pipeline: splitter (s), filter (f), transcriber (t), parser (p), aligner (a), writer (w).
- `storage/` — `app_settings.py` persists `RuntimeSettingsModel` as JSON. `files.py` has constants for known filenames.

### Frontend (`frontend/`)

React 18 SPA, forked from `lrc-maker`. Uses `@lrc-maker/lrc-parser` for lyrics parsing and `wavesurfer.js` for waveform display.

- Three-panel layout: left (Project + Lyrics Import), center (lrc-maker Synchronizer/Editor), right (Auto Timing + Upload). Settings and About are overlay panels.
- `src/shared/api.ts` — Typed fetch wrapper for all backend endpoints. Uses `#const/*` path alias for constants.
- `src/features/` — Feature panels: `RollerPanel.tsx` (Auto Timing), `SettingsPanel.tsx`, `UploadPanel.tsx`, `ProjectPanel.tsx`, `LrclibPanel.tsx`, `AboutPanel.tsx`.
- `src/components/` — Shared UI: `app.tsx`, `editor.tsx`, `synchronizer.tsx`, `audio.tsx`, `waveform.tsx`, `header.tsx`, `footer.tsx`, `toast.tsx`.
- `src/hooks/` — `useLrc.ts`, `useKeyBindings.ts`, `usePref.ts`, `useLang.ts`.
- `src/languages/` — i18n JSON files (zh-CN, zh-HK, zh-TW, ja, ko-KR, en-US, pl-PL, pt-BR, sk-SK).
- `worker/` — Web Workers for audio decryption (NetEase Cloud Music `ncmc-worker.ts`, QQ Music `qmc-worker.ts`).
- Vite config proxies `/api` to `http://127.0.0.1:6789` in dev. Build output goes to `dist/`.

### Key concepts

- **Auto Timing** is the user-facing feature name; **py-roller** is the technical engine invoked as a subprocess.
- The py-roller runtime runs in an **isolated venv** under `<data_dir>/envs/pyroller-py<ver>-<profile>/.venv`. Models are stored separately under `<data_dir>/models/`.
- The six-stage pipeline (`s,f,t,p,a,w`) must be a continuous subsequence. Only options relevant to the selected stages are passed to the CLI.
- `RuntimeSettingsModel` (saved as `settings.json`) holds defaults for all Auto Timing parameters. `RollerService._effective_request()` merges them with each request.
- Data directory structure: `projects/`, `models/`, `envs/`, `cache/`, `settings.json`.
- The UI has no routing library — a single page app with conditional panel visibility.
