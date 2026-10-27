# Architecture

## Translation

Normal workspace lines carry stable IDs, optional translated text and source snapshots.
Version 1 `lyric_document` accompanies the original LRC in project saves and temporary
server-backed workspace recovery. Mismatched source LRC invalidates restoration rather than binding by
position. Source comparison ignores only CRLF/CR/LF differences; rejected restoration
does not erase the stored document merely by opening a project. Timing changes preserve identities; conservative text reconciliation keeps
unique matches, asks before ambiguous losses and supports one-operation restoration.
The bilingual Editor uses two continuous CodeMirror 6 documents with one logical line per
stable lyric ID. Both show LRC timestamps; only the source can change timing. Transaction
filters reject structural changes and protect translated timestamps. Same-size multi-line
edits commit atomically through `editPair`, with shared local undo/redo; external document
updates clear that history. Invalid source timestamps remain editable but block saving,
navigation and export through the shared editor-draft guard.
Natural wrapped heights are measured for all lines (including offscreen lines); line
decorations add visual height without changing text or clipboard content. Both virtual
height maps use the same heights, with synchronized scrolling and a preserved line anchor
on resize. UI styles are scoped to the bilingual editor, using existing buttons and icons.
Auto Timing Review remains separate. Translation updates ordinary dirty state without
creating a persistent project.

`translation.py` owns independent session-only async tasks and versioned default translation instructions.
Connection preferences persist an editable `prompt`; GET also returns `default_prompt` for reset.
The version 3 English default adds lyrical phrasing and semantic review instructions; saved prompts are not overwritten on upgrade and are independent of UI locale.
Each job captures its prompt at creation. Noneditable ID/JSON output rules are appended separately,
and strict result validation still applies. Legacy settings without a prompt use the default.
The `/api/translation` router checks application origin and write headers. Connections
use `/chat/completions`, isolated proxy settings, finite timeouts, no redirects and no
transcript logging. Keyring stores secrets per base URL, with explicit memory-only fallback.
Results require an exact ID set; one format repair is allowed. Requests are idempotent,
only one is active, and cancellation waits for HTTP shutdown. Frontend identity guards
exclude timing changes but invalidate results after source/translation/workspace changes.
No engine resource lock or permanent task directory is used.

## Composition

Tauri starts a local FastAPI sidecar on a random loopback port and opens its WebUI.
React/Vite implements the workspace. The Python package also serves the same
frontend without Tauri. macOS arm64, Ubuntu 24.04 x86_64 and Windows x86_64 use the same desktop build entry; platform resources and engine locks remain separate.

`main.create_app()` composes ProjectService, RuntimeService, StorageService,
JobManager and AutoTimingService through `api/context.AppServices`. Routers handle
HTTP; services own persistence and process behavior. A shared StorageLayoutRef
coordinates configurable roots.

Frontend assets resolve from an explicit path, packaged `frontend_dist`, then
the source checkout's `frontend/dist`. Python distributions include frontend
assets; desktop engine binaries are separate platform resources.

## Workspace

`app/projects/useProjectWorkspace` owns temporary audio, saved project identity,
dirty state and save coordination. New Project resets transient state and draft identity after the save/discard guard. Audio replacement preserves lyrics while updating audio-owned metadata; manual and explicit lyric metadata (including empty values) are protected. Optional per-field metadata_sources persist this ownership; legacy nonempty fields are protected. Local and NetEase audio use the same transient import flow. Lyrics imports merge explicit metadata. Only Save
Project and starting single-project Auto Timing create persistent projects.

First saves use `PUT /api/projects/drafts/{draft_id}` with a stable UUID and staged
publication. A lost response can be retried without creating another project.
Subsequent saves upload audio only when changed. Project switching uses
`ui/ConfirmDialog`; business flows never use browser-native confirmation.

After the first project save, the workspace coordinator saves after 1 second of
inactivity, with a 10-second ceiling during continuous valid edits. Manual saves,
Ctrl/Command+S, transitions and desktop exit flush editor input and pending saves.
Responses acknowledge only their captured signature; failures suspend automatic
retries. Invalid editor input is retained in recovery, not committed to the project.
Project saves use a durable redo journal under the project directory. Readers finish
an interrupted transaction before loading LRC and structured translations together.
New audio is published before committing its reference; superseded audio is removed
after the transaction succeeds.

`GET/PUT/DELETE /api/workspace/recovery` manages one versioned record under `recovery/`
alongside projects. PUT accepts a record and optional pending audio; audio keys are
UUIDs managed by the backend. The record includes project/draft identity, the lyric
snapshot, dirty state and unfinished editor text. It is not a project or cache.
Saved audio is reused; a pending audio copy is released after project persistence.
Desktop startup does not use origin-scoped localStorage for workspace recovery.
Unfinished edits require an explicit Restore or Discard Changes decision; this startup
prompt has no Cancel action and ignores Escape/backdrop dismissal. Discard opens the
saved project when available, otherwise an empty workspace. Interrupted decisions and
recovery errors retain an actionable recovery screen without initializing autosave or
overwriting recovery data.
The native shell negotiates close/quit through two restricted commands available
only to the main window at its current loopback origin; the backend remains alive
until saving completes or the user explicitly discards.

The normal lyric reducer owns selection, timestamp edits, mark snapshots and
bounded insertion/deletion undo. Preview creates a separate reducer instance.
Only the visible editor is mounted, so keyboard handlers cannot edit both
documents. Player state is shared, but preview editing is disabled when its
source project/audio no longer matches.

## Protocol v2

The desktop pins py-roller 0.10.3, source commit `6d3ded2`. The compatibility
gate accepts `>=0.10.3,<0.11` with protocol 2. There is no v1 fallback.

```text
runtime-python -m pyroller run --request /absolute/run/request.json
```

`auto_timing/contracts.py` validates public options. `protocol.py` owns request
input normalization and strict JSONL envelope validation. It checks version,
engine identity, request identity, sequence, revision and line/time fields.
Repeated events are ignored. Snapshots replace the entire revision; occurrence
IDs are not stable across revisions. Unknown stages/events remain diagnostics.

Success requires a completed event, exit code zero, a final snapshot, valid
artifact paths inside the output directory, matching alignment identity and
times, and an LRC consistent with the final alignment. Empty success is legal.
A startup failure with an engine-generated request ID is diagnostic only.
Malformed JSON or conflicting terminal states cannot become success.

Ordered snapshots contain timed lines and unaligned lines keyed by the submitted
input_line_index. Both arrays are validated and replaced together. The review
merges them in input order, retaining unresolved rows without timestamps; drafts
keep independent host IDs. Unordered preserves the occurrence-discovery workflow.
Requests always send alignment_mode. Existing settings and old runs without the
field are interpreted as unordered, while new installations default to ordered.

The host uses no private py-roller algorithm modules or research configuration.
Whisper finds sung occurrences; CTC refines their times. Options carry auto/en/zh/zh-en/mul. One pinned adapter invokes `pyroller.language.resolve_language` in the managed interpreter before model admission. Requests freeze the resolved language while run records retain the requested Auto; batch children resolve independently. Review snapshots and final artifacts must match the frozen language/backend. The host never represents scores as accuracy or verification.

## Execution and Persistence

`auto_timing/service.py` freezes plain input and an audio digest, creates a
task-specific hard link (or cross-device copy), and starts a process group.
The engine creates its own output directory. stdout JSONL and stderr are read
concurrently; full streams are persisted while status requests remain compact.
Audio snapshots are released after exit, including cancellation/failure.

Cancellation transitions to Cancelling and sends termination, escalating after
eight seconds. The global resource lock stays held until the process exits.
Inference, model operations, runtime installation and storage migration/cleanup
share that lock. Queue workers run one child at a time; a failed child does not
stop later children.

`auto_timing/store.py` writes records/drafts atomically under
`results/<project>/<run>/`. Draft writes require the expected version.
On restart active records become Interrupted; known orphan engine processes are
matched by their unique request path and terminated on macOS before releasing
temporary audio. Queues never resume silently. Engine evidence lock directories
are never automatically removed.

Run records retain configuration, input identity, latest snapshot, errors,
artifact locations and application history. Batch parents retain child IDs.
Result deletion is explicit and updates the parent's child list. New Batch resets
only the visible batch and project selection, retaining options, projects and history.
Individual results can be deleted from the batch list; deleting the final child also
removes its parent. Whole-batch deletion removes the parent and all child results,
drafts and logs, preserving source projects and already-applied lyrics. Both deletion
routes use the shared resource lock, reject active records and return `deleted_ids`
for frontend history, batch and review synchronization. Project change events refresh
the batch picker and remove stale selections; submission rechecks available projects.

## Preview and Apply

`useTimingPreview` follows engine revisions until the first content/time edit.
The first edit freezes a host-owned draft with stable internal row IDs. Selection
and marks do not freeze it. Draft saves serialize with optimistic versions; a
lost response is recoverable only when the stored payload matches our attempt.

Use Latest confirms discarding edits. Apply is available only after termination:
completed results apply normally; failed/cancelled/interrupted results require
Partial confirmation. Empty results and changed workspace lyrics also require
confirmation. Project, audio identity and workspace revision are rechecked after
asynchronous operations and before replacement.

Apply imports only text/timing into the current workspace, preserves metadata
and audio, resets marks/undo and marks the workspace dirty. The ordinary workspace
autosave coordinator persists this change for an existing project.
Opening a batch result first uses the normal project-switch save flow.

## API

| Route | Purpose |
| --- | --- |
| POST /api/auto-timing/preflight | Input, runtime and model checks |
| POST /api/auto-timing/runs | Start a saved input version |
| GET /api/auto-timing/runs | Compact history, optionally filtered by project |
| GET /api/auto-timing/runs/{id} | State, progress and latest snapshot |
| POST /api/auto-timing/runs/{id}/cancel | Cancel and wait asynchronously |
| GET/PUT /api/auto-timing/runs/{id}/draft | Versioned editable preview |
| GET /api/auto-timing/runs/{id}/binding | Current project/audio match |
| POST /api/auto-timing/runs/{id}/applied | Record application, without saving lyrics |
| GET /api/auto-timing/runs/{id}/diagnostics | Bounded stderr tail and result path |
| GET /api/auto-timing/runs/{id}/lrc | Completed engine LRC |
| DELETE /api/auto-timing/runs/{id} | Explicit result/draft removal; reports all deleted IDs |
| DELETE /api/auto-timing/batches/{id} | Explicit whole-batch result/draft/log removal |
| POST /api/auto-timing/batches | Create serial queue |
| GET /api/auto-timing/batches/{id} | Parent and child summaries |
| POST .../batches/{id}/cancel, retry, resume | Cancel, retry failures, continue interrupted items |
| GET/POST /api/auto-timing/models | Host integrity status; verify/download/repair/remove selected models |
| POST /api/runtime/auto-roller/ensure | Automatic component check/preparation and repair |
| GET /api/storage/usage | Five exclusive storage categories |
| POST /api/storage/cache/clear | Clear known temporary and inference cache |
| POST /api/storage/relocate | Verify and switch the entire data root |

Old roll/batch-preview endpoints return 410. Removed storage and runtime management routes are not registered. Runtime maintenance
still uses `/api/runtime/auto-roller` and `/api/jobs`. Project, lookup, upload
and storage APIs retain their existing responsibilities. LRCLIB uses pylrclib's
structured Python API.

## Runtime and Distribution

The managed environment lives in `runtime/venv`; successful layout migration removes old owned environments.
`runtime/preparation.py` coordinates idempotent preparation for desktop startup, Settings and Start.
`POST /api/runtime/auto-roller/ensure` accepts only original/vocals capability, optional multilingual checks and repair intent;
the status response includes preparation state, capabilities and job ID. Concurrent requests
share a task, with Vocals escalation after the base process exits. Other resource owners cause
a busy response. Old install/upgrade/doctor/vocals-install writes return 410.

The desktop's React StartupGate uses the application icon and shared loading animation,
requests the saved audio capability, and mounts the workspace after readiness. Failure permits
repair or continuing to manual editing. The runtime response advertises startup_preparation
only when app resources are configured; unbundled WebUI users are not forced into installation.
Each backend session checks the first requested capability; a frontend reload reuses that check. Persisted bundle fingerprints detect
updates; compatible matching installations are reused, explicit repair recreates the managed
venv, and interrupted installations are rebuilt on next preparation. Preparation never downloads
models or falls back to system Python. App shutdown cancels and waits for the preparation process.
Start retains a cancellable workspace/options identity and revalidates it after preparation;
repair does not resume a failed start intent.

`runtime/installer.py` installs only hashed wheels from bundled resources,
offline. Runtime health uses doctor.runtime_ok independently of model readiness.
Model downloads are explicit. One `StartupGate` owns runtime readiness, model checks,
issue prompts and downloads, keeping the illustration mounted across phases. Environment
failures can bypass model checks and enter manual editing directly. Fresh installations
offer shared models plus language-selected CTCs; later startup reports selected missing models and corrupt/failed installed models
using the backend `startup_issues` list, shared with Settings. Declining/closing skips only
the current launch. The onboarding flag controls the initial prompt form, independently
of preference reset; existing settings without this field count as upgrades.

`auto_timing/model_catalog.py` pins required files, sizes, SHA-256, official revisions and
ModelScope upload commits. The host downloads these files directly without an additional
SDK. `model_service.py` owns installation receipts, session integrity, transactional
replacement and model status. Every backend session hashes installed managed files fully;
subsequent inference checks reuse only unchanged file signatures. Explicit model paths
remain under engine compatibility checks. Single/batch preflight rejects unchecked managed
models and always forces engine offline mode, including old configurations with offline=false.

Model operations use cancellable host workers in JobManager, the existing job API and the
shared resource lock. Terminal cancellation is published only after the worker has exited
its file/network operations. Downloads snapshot source/proxy preferences and explicitly
disable inherited proxies when direct. Validated Range responses permit resume, bounded
retries retain partials, and full hashes gate publication. Staging lives in cache/model-downloads;
the installed model stays usable until the entire replacement passes. A sibling .previous
directory recovers interrupted publication. Receipts under engine/models distinguish
intentional deletion from unexpected loss, but neither suppresses startup reminders.
No persistent hash result substitutes for startup hashing. Phase-local `completed/total`
measure aggregate bytes; `bytes_downloaded/bytes_total` measure the current model.
Checking, downloading and final verification reset their own counters. New staged files
are fully hashed once during visible final verification before publication. Cached session
checks do not claim to read bytes again. Poll recovery observes the same job; cancellation
waits for worker exit. External paths use the public engine model inventory and suppress
managed-copy prompts. Network timeouts are 1–30 seconds; old larger preferences clamp to 30.

One `StorageLayout` derives projects, engine, runtime, results and cache from the
selected application root. `services/storage_inventory.py` supplies exclusive
five-category accounting. Auto Timing settings owns all model operations;
Storage owns root relocation, cache cleanup and project/result management.
The location pointer is outside preferences. One-time layout transactions remove
old owned data after runtime verification; ordinary reads have no cleanup side effects.

`desktop/prepare_engine.py` builds the pinned source wheel on the build machine,
resolves target dependencies into a hashed wheelhouse, extracts FFmpeg and
audits native binaries. `build_resources.py` builds a fresh PyInstaller sidecar
using standalone Python. No end-user source compilation is permitted.
See [desktop packaging](DESKTOP.md) and [validation](AUTO_TIMING_VALIDATION.md).

## Multilingual models and native components

The catalog retains `ctc` for English and adds `ctc-zh` and `ctc-mul`, pinned to upstream and ModelScope commits. `model_prepared_kinds` controls missing reminders; installing another model adds it, deletion retains intent, and preference reset preserves the selection. One validated managed or external CTC suppresses missing managed CTC reminders; corruption, check failures and language-specific run admission remain unchanged. All installed managed weights are hashed at startup. Language-specific external CTC paths map to the engine's single `ctc_model` only after resolution; the old path stays English-only.

The base wheel closure includes Mandarin and mul Python dependencies. Bundled eSpeak NG 1.52.0 is built from hashed source without optional system audio libraries. `PHONEMIZER_ESPEAK_LIBRARY` and `ESPEAK_DATA_PATH` point at bundled components. Its source, licenses, build flags and data join the engine manifest. Doctor checks multilingual capability separately; failure leaves verified base capabilities usable. Models remain independent of component repair.

Single retry and batch retry/resume retain the original resolved language. Old records without language are English; active settings without language migrate to Auto. Runtime compatibility requires >=0.10.3,<0.11 and protocol 2.

## Frontend progress and playback

Auto Timing uses one progress-card position for environment checking, component
preparation, task submission and engine execution. Preparation consumes the existing
runtime state callback; checking, preparation and submission use indeterminate progress.
Failures retain the card with repair/retry actions. Repair alone does not restart
alignment. Cancelling preparation withdraws the start intent without cancelling shared
environment work. Batch execution also shows finished child count and current stage.

Audio playback uses a logarithmic range from 1/3 to 3, with 1 at the slider center.
Slider input, keyboard changes (0.2 logarithmic steps) and assignments through the
audio hook share the same bounds. Playback speed changes do not modify source audio
or Auto Timing input. Clicking the speed display resets playback to 1.

The initial HTML loader and React startup gate use the same packaged application icon
and decorative halo, counter-rotating orbits and waveform animation. Decorations are
hidden from assistive technology, pause while startup awaits a decision or has failed,
and respect reduced-motion preferences. Branding changes do not delay startup readiness.

Task progress presentation lives in `ui/TaskStatus`, shared by Auto Timing,
environment preparation, translation and connection tests. Indeterminate stages do
not advertise a percentage; terminal failure and connection outcomes retain the
same card. Translation toolbar actions remain mounted and disabled during work,
with cancellation in the task card. Errors and review-save notifications use shared
messages; timing diagnostics use separate command, error and log containers.

LRC tool actions and settings reset use the public button tones. Settings-specific
legacy button rules exclude public buttons so danger hover/focus colors are retained.
Custom translation language codes use the shared Input with keyboard focus feedback.
Native controls follow explicit and automatic light/dark themes via `color-scheme`;
checkbox glyphs use the computed theme contrast color. Tool borders and shared muted
surfaces use theme variables. The crash boundary presentation is unchanged.

## Panel session ownership

The workspace exposes its existing draft ID as `panelSessionId`. New/open/reset
transitions change this ID, while first save and audio replacement retain it. Import
audio, import lyrics and publishing panels are keyed by this session. Search defaults
track automatic versus manual ownership per field, including explicit empty edits;
automatic fields follow current metadata only when auto-fill is enabled. Saved project
identity is not used as a search-session boundary. Async search, lyric fetch, file reads
and publish-plan responses are guarded by session/material/input revisions and request
sequence; unmounted, superseded and out-of-date callbacks cannot update the new panel.
Publish plans also bind all publication inputs and are checked again at submission.
An already submitted upload is never automatically repeated on a workspace transition.

Single-run Retry uses one predicate for its label and admission: current project,
workspace, signature, options and complete historical identities must match, and the
run must be terminal. Changed inputs offer Start. Active runs remain monitored with
their project title even when their source workspace is no longer displayed; history
and batch queues survive single-workspace changes. Backend retry revalidates audio,
normalized lyric hash and options inside the resource lock before reusing the resolved
language and freezing inputs. Legacy records without these identities require Start.
