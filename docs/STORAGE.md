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

Application cache/log folders and pip/XDG tool caches are no longer exposed as first-class cleanup sections. They will show under **Other** if they contain files.

## Overview

The overview shows total disk usage and these categories:

- **Projects**: all project folders under `projects/`.
- **Models**: the whole `models/` directory.
- **Runtime Environments**: the whole `envs/` directory.
- **Other**: first-level files/folders under the data directory that are not `projects/`, `models/`, or `envs/`.

The **Other** section also lists its first-level items, such as `settings.json`, `cache/`, `logs/`, `uploads/`, or `outputs/`.

## Projects

Projects are filtered by **Older Than**. The project list only shows projects whose `updated_at` is older than the selected value. **Clear All Intermediate** and **Delete All** only operate on the projects currently shown by this filter.

Each project row shows:

- **Total**: the whole project folder size.
- **Intermediate**: the size of `projects/<project_id>/intermediate/`.

Per-project actions:

- **Clear Intermediate**: deletes only `projects/<project_id>/intermediate/`.
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
- frontend requests do not pass arbitrary paths for deletion; the backend maps selected project/model/runtime IDs to known paths.
