# Storage and cleanup

[Documentation index](README.md) · [User guide](USER_GUIDE.md)

## What creates files

Opening local audio uses a temporary frontend workspace. It does not create a project or upload the audio. **Save Project** or starting single-project **Auto Timing** persists the workspace. Re-saving a project updates its lyrics and metadata without another audio copy. Direct LRC export needs no project.

Unsaved audio is session-only. Browser editor text recovery is separate from backend project persistence and does not restore an audio file after restart. Model downloads and runtime setup are separate, explicit operations.

The default data directory is `~/.local/share/rollingpebble`. Override it with `--data-dir` or `LRC_ROLLER_DATA_DIR`.

| Location | Contents |
| --- | --- |
| `projects/` | Saved audio, project metadata, lyrics, Auto Timing intermediates and artifacts |
| `models/` | Transcriber and other audio-model caches |
| `envs/` | Isolated py-roller environments |
| `cache/` | Redirected pip/XDG and other reproducible caches |
| `work/` | Job request files and temporary task work |
| `toolchains/` | Python copied from a supported desktop bundle for runtime setup |
| `settings.json` | Application settings and runtime history |

Projects and model roots can be relocated through Settings. Runtime layout also understands configured cache, runtime, and work roots. A project audio reference is relative to its project directory. Root migration updates persisted settings and services, and retains the source backup; it must not be treated as automatic source-disk cleanup.

## Manual cleanup

Settings → Storage & Cleanup reports projects, models, runtimes, and other data.

| Operation | Scope |
| --- | --- |
| Safe Cleanup | Project `intermediate/` directories and external cache |
| Clear Intermediates | Only intermediates for the selected/listed projects |
| Delete Projects | Entire selected project directories, including audio and saved lyrics |
| Delete Model | The selected model cache; future use can download it again |
| Delete Runtime | The selected inactive runtime, without deleting models |
| Other cleanup | Selected removable app-data items |
| Browser Storage | Fixed browser keys and application CacheStorage entries; no backend project files |

The **Older Than** filter limits which projects are listed and selected by bulk actions. It does not enable automatic deletion. Model caches can include transcriber provider hub directories, manifests, and Torch/Demucs data.

Confirmation dialogs run inside the application. Project List deletion has a ten-second undo period before the delete request. Settings cleanup executes after confirmation and does not have that undo period. Deletions use filesystem removal, not the operating system Trash.

## Automatic project deletion — current behavior

`project_auto_delete_days` defaults to `0` (off). A positive value enables deletion of entire expired projects, including audio and saved lyrics.

**This is not a background scheduler.** The policy runs when the backend storage-usage operation is requested, including opening Settings or refreshing storage. The field saves on blur, then refreshes storage; enabling or shortening the period can therefore delete qualifying projects immediately.

Age is calculated from the recorded last-opened timestamp, falling back to directory modification time. Projects associated with running jobs are skipped. This protection does not represent an editor-session lease and does not cover every manually open workspace. Automatic deletion has no confirmation or ten-second undo window. Leave it off if you need to retain saved work indefinitely.

## Deletion boundaries

Paths are resolved against configured managed roots, which can be outside the original data directory. Cleanup rejects paths outside those roots and does not accept arbitrary frontend deletion paths. Symlink roots are rejected. The cleanup service protects active runtimes, running projects, settings, and busy model/runtime/cache operations according to their job guards. These storage-cleanup guards should not be confused with a general guarantee that every project has an active-editing lock.

First-time workspace saves are written in a staging directory and made visible only after completion. Failed saves remove their staging data. A stable draft ID makes creation retries reuse the same saved project rather than duplicate audio.
