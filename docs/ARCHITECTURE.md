# lrc-roller v0.2 architecture

## Goal

A local web application for lyrics lookup, automatic timing, manual editing, and LRCLIB publishing.

The first UI version is English-only. The main workflow uses user-facing names such as **Lyrics Import** and **Auto Timing**. Technical engine names are reserved for Settings, command previews, logs, and diagnostics.

## Runtime

- Backend: FastAPI on `127.0.0.1:6789`
- Frontend: React/Vite, based on `lrc-maker`
- Data directory: `~/.local/share/lrc-roller`

## Integration choices

### pylrclib

`pylrclib` is imported directly. The backend uses:

- `pylrclib.api.ApiClient`
- `pylrclib.models.TrackMeta`
- `pylrclib.models.LyricsBundle`
- `pylrclib.workflows.up.build_upload_plan`

This keeps search/get/upload-plan/upload structured and avoids parsing CLI output.

### Auto Timing engine

The user-facing feature is **Auto Timing**. The technical engine is `py-roller`.

`py-roller` is invoked as a subprocess worker:

```bash
py-roller run --stages t,p,a,w --audio audio.flac --lyrics plain.txt --output-roller pyroller_output.lrc --language zh
```

The command runs outside the FastAPI request path. Logs are captured into an in-memory job object and exposed through `/api/jobs/{job_id}`.

## API summary

- `GET /api/health`
- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/{project_id}`
- `POST /api/projects/{project_id}/lyrics`
- `POST /api/projects/{project_id}/editor`
- `POST /api/lrclib/search`
- `POST /api/lrclib/get`
- `POST /api/projects/{project_id}/roll/preview`
- `POST /api/projects/{project_id}/roll`
- `GET /api/jobs/{job_id}`
- `POST /api/jobs/{job_id}/cancel`
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

- `lrc-roller dev`: start backend and Vite frontend for development.
- `lrc-roller setup --profile auto`: run frontend install and `py-roller install`.
- `lrc-roller doctor`: inspect package and runtime status.
