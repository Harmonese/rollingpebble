<p align="center">
  <img src="https://raw.githubusercontent.com/Harmonese/rollingpebble/main/frontend/public/favicons/apple-touch-icon.png" alt="Rolling Pebble" width="120" height="120">
</p>

# Rolling Pebble

[![PyPI](https://img.shields.io/pypi/v/rollingpebble.svg)](https://pypi.org/project/rollingpebble/)
[![Python](https://img.shields.io/badge/python-3.10%2B-3776AB.svg)](https://www.python.org/downloads/)

Rolling Pebble is a local lyrics workstation for searching, editing, timing, translating, organizing, and publishing LRC lyrics.

It provides a Tauri desktop app for macOS Apple Silicon and a browser interface backed by a local Python server. Your projects, audio, lyrics, runtime environments, and model caches stay on your machine. Auto Timing is powered by `py-roller` in an isolated runtime so large audio dependencies do not pollute the main app environment.

## What It Does

- **Import** audio and lyrics from local files, LRCLIB, and supported online sources.
- **Edit** metadata and lyric text in a focused LRC editor.
- **Synchronize** timestamps manually when you want frame-level control.
- **Repeat lyrics** with numbered marks, playback-time insertion and undo.
- **Auto-time (Experimental, English)** with py-roller 0.10.2, then review an independent editable preview before applying it.
- **Translate** through a local or cloud OpenAI-compatible service, with synchronized bilingual LRC editors.
- **Save and recover** projects automatically after their first save, including translations and audio changes.
- **Manage storage** for projects, models, results and temporary data in one application directory.
- **Publish** prepared lyrics through LRCLIB workflows.
- **Use multiple languages** through the built-in i18n layer.

## Typical Workflow

1. Open an audio file in a temporary workspace; importing does not create a project.
2. Import lyrics from LRCLIB, a local file, or the editor.
3. Clean up the lyric text and metadata.
4. Use the Synchronizer for manual timing and export directly. Save Project establishes a project; later edits save automatically. Auto Timing also saves the workspace before processing.
5. Review Auto Timing results in Auto Timing Review. Apply updates the workspace and follows normal autosave. Export LRC or publish through LRCLIB.

The Project panel shows **Unsaved**, **Saving**, **Saved**, or **Save failed**. Save Project or Ctrl/⌘+S saves immediately. Replacing local audio preserves lyrics, timestamps and marks. Importing lyrics preserves existing metadata unless the imported file supplies replacements. Existing projects save automatically, uploading audio only when it changes. A single recovery workspace preserves unfinished text, translations and pending audio without adding a project to the list; startup offers recovery after an interruption. Desktop exit waits for saves or an explicit discard.

## Install

### macOS Desktop (Apple Silicon)

Download an arm64 DMG from [GitHub Releases](https://github.com/Harmonese/rollingpebble/releases), open it, and drag **Rolling Pebble.app** into **Applications**. This checkout prepares version **0.8.0**.

1. Open the app; the unified startup screen prepares or checks bundled components.
2. On first use, choose whether to download Whisper large-v3, CTC and Demucs. ModelScope is the default source; official downloads and HTTP(S) proxy settings are also available.
3. Subsequent launches verify installed weights and offer targeted download or repair for missing or damaged models. Choose Later to enter the workspace without downloading.

The app bundles Python 3.12.15, FFmpeg and hashed binary wheels for py-roller 0.10.2 and its dependencies. Runtime installation is offline and needs no compiler or Homebrew. Model weights are downloaded separately through startup setup or Settings. HTTP(S) proxies are supported; SOCKS proxies are not. Auto Timing defaults to offline operation.

**Distribution limitation:** the DMG is ad-hoc signed and is not Apple-notarized. macOS Gatekeeper may block first launch. Do not disable system-wide security protections. This build targets Apple Silicon with macOS 14 or newer.

### Command Line

The Python distribution includes the backend and WebUI, but not the platform-specific engine wheelhouse, standalone Python or FFmpeg. Manual editing works independently. For the supported Auto Timing installation use the macOS arm64 app, or prepare the matching engine resources from a source checkout as described in [desktop packaging](docs/DESKTOP.md).

For the command-line installation below, Rolling Pebble requires Python 3.10 or newer. Auto Timing requires the matching bundled Python 3.12 and engine resources; it does not fall back to system Python.

Recommended install:

```bash
python -m venv rollingpebble-env
. rollingpebble-env/bin/activate
python -m pip install -U pip
python -m pip install rollingpebble
rollingpebble
```

On Windows PowerShell:

```powershell
py -m venv rollingpebble-env
.\rollingpebble-env\Scripts\Activate.ps1
python -m pip install -U pip
python -m pip install rollingpebble
rollingpebble
```

Then open:

```text
http://127.0.0.1:6789
```

## Auto Timing

Auto Timing uses Protocol v2 and a fixed English line-level pipeline. Ordered follows complete input lyrics, including every repeat, and retains unresolved lines for manual timing. Unordered discovers sung occurrences, including repetitions absent from the input. CTC refines timing. New installations default to Ordered; existing settings retain Unordered. Results can still miss or misplace lines and require review. Heavy dependencies stay in a separate runtime under the app data directory.

To set it up:

1. Launch the desktop app. The startup screen prepares or checks bundled components, then opens the workspace.
2. Download the required models explicitly.
3. If preparation fails, use **Repair**. Version and logs are available in the collapsed **Diagnostics** section.

Preparation is offline and shared between startup, Settings and Start. Failed startup checks offer Repair or Continue for manual editing. Closing Settings does not cancel it. Cancelling a pending Start cancels only the intent to run; changing the workspace or options while waiting also prevents automatic start.

Prepare the fixed models before starting. Original is the default audio source; Vocals is an explicit choice. CTC supports Auto/CPU/MPS; Whisper and Demucs run on CPU. Runtime readiness and model readiness are separate. No CUDA, language, Full/Quick or research-algorithm switches are exposed.

Auto Timing Review follows engine revisions until the first text or timing edit, then retains an independent autosaved draft. Use Latest discards edits after confirmation. Apply updates the workspace and triggers normal autosave for an existing project. Failed or cancelled runs with content can be applied as Partial after confirmation. Batch runs are serial and each result is reviewed separately.

The current supported py-roller range is:

```text
py-roller>=0.10.2,<0.11, protocol 2 (desktop pinned to 0.10.2)
```

## Storage and Privacy

Rolling Pebble is local-first. It stores data under the user data directory, for example:

```text
~/.local/share/rollingpebble
```

Inside the app, **Settings -> Storage** manages the application location and shows Projects, Models, Results, Cache and Components. Model controls live in **Auto Timing** settings. Runtime components are managed automatically; repairing them preserves models and projects. A separate recovery area retains the current unfinished workspace and is protected from ordinary cache cleanup.

Rolling Pebble contacts external services for LRCLIB lookup/publishing, online imports, model downloads, and configured Translation requests. Translation sends lyric text and title/artist/album to your chosen service, never audio or file paths. API keys use the system credential store, with explicit session-only fallback when unavailable. Local model services can keep translation on your own machine.

## Documentation

- [User guide / 使用指南](docs/USER_GUIDE.md): temporary workspaces, saving, timing, shortcuts, export and deletion.
- [Storage and cleanup](docs/STORAGE.md): storage roots and the exact automatic-deletion behavior.
- [Development](docs/DEVELOPMENT.md) and [architecture](docs/ARCHITECTURE.md).
- [Desktop packaging](docs/DESKTOP.md) and [release checklist](docs/RELEASE.md).
- [Protocol v2 migration](docs/AUTO_TIMING_V2.md) and [validation record](docs/AUTO_TIMING_VALIDATION.md).
- [Documentation index](docs/README.md) and [changelog](CHANGELOG.md).
