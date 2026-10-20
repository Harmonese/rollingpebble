# Storage and cleanup

[Documentation index](README.md) · [User guide](USER_GUIDE.md)

## One application directory

The default is `~/.local/share/rollingpebble`. Settings → Storage changes the
entire location; individual categories do not have separate locations.
CLI `--data-dir` and `LRC_ROLLER_DATA_DIR` remain explicit overrides.

| Location | Contents |
| --- | --- |
| `settings.json` | Current preferences |
| `projects/` | Saved audio, lyrics, translations and metadata |
| `recovery/` | One current workspace snapshot, unfinished editor text and pending audio |
| `engine/models/` | Shared Whisper/Demucs and English, Mandarin, multilingual CTC weights |
| `engine/ctc/`, `engine/whisper/`, `engine/separation/` | Reusable inference cache |
| `runtime/python/`, `runtime/venv/` | Managed interpreter and one environment |
| `results/<project>/<run>/` | Requests, results, logs and editable drafts |
| `cache/` | Temporary application and dependency data |

The engine's internal directory layout follows its public cache-root contract.
Model weights are persistent data, not ordinary cache. Explicit external model
files remain unmanaged.

Opening audio is transient. Save Project or starting single-project Auto Timing
establishes the project; later edits save automatically. Recovery may stage temporary audio without creating a project. Re-saving does not duplicate audio. Task audio snapshots
are released after process exit; retained results do not retain another audio copy.

## Settings

Auto Timing owns model download/removal, defaults, network options and diagnostics.
Model integrity receipts live under `engine/models/.installations.json`; they track installation
and intentional deletion, not persisted successful hash checks. Preferences retain selected preparation kinds: selected missing models keep startup reminders, while unselected language models do not. Installed models are checked regardless of preparation selection. Resumable download files live
under `cache/model-downloads` and can be removed by cache cleanup when no task is active.
Storage shows Location and five usage rows: Projects, Models, Results, Cache,
Components. Models links to Auto Timing. Projects and Results open management
dialogs; Components is read-only. Usage is exclusive logical file-byte accounting,
not a promise of physical space reclaimed on a deduplicating filesystem.

Clear Cache removes known temporary data and engine inference caches. It preserves
models, components, projects, workspace recovery, results and drafts, and refuses locked caches.
Deleting a result also deletes its draft; empty batch records are removed.
Deleting a project does not delete independent results. There is no automatic
project expiry, and reading usage never deletes data.

Deletion uses the existing application confirmation dialog and filesystem removal,
not Trash. Project List retains its ten-second undo period; Settings deletions
take effect after confirmation.

## Location changes and initial cleanup

The selected root is recorded in the system application configuration directory
(on macOS, `~/Library/Application Support/Rolling Pebble/storage.json`).
It is separate from user preferences, so Reset does not disconnect data.

Relocation requires an empty, non-overlapping destination and idle resources.
The frontend completes its workspace-save prompt and flushes preview drafts.
Durable files are copied and verified, readable artifact paths are updated, and
the runtime is prepared at its final location before switching. Virtual
environments are rebuilt because they contain absolute paths. A transaction
records progress for retries. Successful relocation removes owned source data;
unknown files are left intact. No permanent source backup or redirect directory
is retained.

The one-time layout transition preserves projects, current engine models and
results. After the new runtime passes its check, it removes old `envs/`,
`toolchains/`, legacy `models/`, pip cache and the old settings backup.
Old preferences and per-category relocation APIs are not supported. External
shared caches and custom files are never swept into application cleanup.
