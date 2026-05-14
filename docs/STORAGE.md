# Storage and cleanup

lrc-roller stores local data under the configured data directory. The default is usually:

```text
~/.local/share/lrc-roller
```

You can override it with `--data-dir` or `LRC_ROLLER_DATA_DIR`.

## Storage & Cleanup panel

The Settings drawer has a **Storage & Cleanup** section at the bottom. The current panel focuses on the parts that actually matter for this app right now:

- **Projects**
- **Models**
- **Runtime Environments**
- **Other**
- **Browser Storage**

External tool cache data is no longer exposed as a first-class cleanup section. If present, it appears under **Other** as **External Cache** and is included in **Safe Cleanup**.

## Overview

The overview shows total disk usage and these categories:

- **Projects**: all project folders under `projects/`.
- **Models**: the whole `models/` directory.
- **Runtime Environments**: the whole `envs/` directory.
- **Other**: known app data and first-level files/folders under the data directory that are not `projects/`, `models/`, or `envs/`.

The **Other** section also lists its first-level items. Known entries get readable names:

- **Settings File**: `settings.json`.
- **External Cache**: `cache/`, currently used for redirected pip/XDG cache paths.

System noise such as `.DS_Store` is ignored. Unknown first-level files or folders are shown by their own names so they can be noticed and removed intentionally from **Other**.

Each **Other** row can open its location. Folder rows open that folder; file rows open the parent folder. **Settings File** can be opened but is protected from deletion.

## Safe Cleanup

The top-level **Safe Cleanup** action removes project `intermediate/` directories and **External Cache**. These files can be recreated or downloaded again when needed. External Cache is locked while Auto Timing or runtime maintenance is running.

## Projects

Projects are filtered by **Older Than**. The project list only shows projects whose `updated_at` is older than the selected value. **Clear Intermediates** and **Delete** only operate on the projects currently shown by this filter.

Each project row shows:

- **Total**: the whole project folder size.
- **Intermediate**: the size of `projects/<project_id>/intermediate/`.

Per-project actions:

- **Clear Intermediates**: deletes only `projects/<project_id>/intermediate/`.
- **Delete**: deletes the whole `projects/<project_id>/` folder.

A project with a running job is blocked from deletion and intermediate cleanup.

## Models

Models are scanned from the managed `models/` directory.

Known py-roller transcriber cache layouts are detected under:

```text
models/transcriber/providers/huggingface/hub/models--*
models/transcriber/providers/faster_whisper/hub/models--*
models/transcriber/manifests/transcriber-index.json
```

The panel also detects:

```text
models/torch/*
models/<other-first-level-folder>
```

Model rows show the label, provider/backend, path, size, and file count. You can open a model folder or delete a specific model cache item. Deleting a model does not delete projects, but Auto Timing may download the model again when needed.

## Runtime Environments

Runtime environments are scanned from:

```text
envs/*
```

Each runtime row shows its runtime id, profile, status, py-roller version, Python version, size, and file count when available from `runtime.json`.

The current active runtime is marked and protected. Runtimes are also protected while Auto Timing, runtime install, or runtime doctor jobs are running.

## Browser Storage

Browser Storage clears fixed local browser keys and lrc-roller CacheStorage entries. It does not delete backend project files.

## Safety boundaries

The cleanup backend enforces these rules:

- cleanup paths must stay inside the configured data directory;
- symbolic links are not followed or deleted as cleanup roots;
- running projects cannot be deleted or modified;
- model and runtime cleanup are locked while Auto Timing or runtime maintenance is running;
- the active runtime is protected;
- `settings.json` is protected;
- Other cleanup is limited to first-level data directory items already reported by the backend;
- frontend requests do not pass arbitrary paths for deletion; the backend maps selected IDs or reported Other paths to known paths.
