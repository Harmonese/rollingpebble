<p align="center">
  <img src="https://raw.githubusercontent.com/Harmonese/rollingpebble/main/frontend/public/favicons/apple-touch-icon.png" alt="Rolling Pebble" width="120" height="120">
</p>

# Rolling Pebble

[![PyPI](https://img.shields.io/pypi/v/rollingpebble.svg)](https://pypi.org/project/rollingpebble/)
[![Python](https://img.shields.io/badge/python-3.10%2B-3776AB.svg)](https://www.python.org/downloads/)

Rolling Pebble is a local lyrics workstation for searching, editing, timing, organizing, and publishing LRC lyrics.

It provides a Tauri desktop app for macOS Apple Silicon and a browser interface backed by a local Python server. Your projects, audio, lyrics, runtime environments, and model caches stay on your machine. Auto Timing is powered by `py-roller` in an isolated runtime so large audio dependencies do not pollute the main app environment.

## What It Does

- **Import** audio and lyrics from local files, LRCLIB, and supported online sources.
- **Edit** metadata and lyric text in a focused LRC editor.
- **Synchronize** timestamps manually when you want frame-level control.
- **Auto-time** lyrics with `py-roller` using isolated CPU/CUDA runtime profiles.
- **Review and clean up** projects, model caches, runtime environments, and app data.
- **Publish** prepared lyrics through LRCLIB workflows.
- **Use multiple languages** through the built-in i18n layer.

## Typical Workflow

1. Open an audio file in a temporary workspace; importing does not create a project.
2. Import lyrics from LRCLIB, a local file, or the editor.
3. Clean up the lyric text and metadata.
4. Use the Synchronizer for manual timing and export directly. Save Project keeps your audio and lyrics; Auto Timing also saves the workspace before processing.
5. Review the generated LRC, export it, or publish it through LRCLIB.

The Project panel uses the same layout throughout, with **Project Status** showing **Saved** or **Unsaved**. Repeated saves update the existing project without copying the audio again.

## Install

### macOS Desktop (Apple Silicon)

Download the v0.7.3 arm64 DMG from [GitHub Releases](https://github.com/Harmonese/rollingpebble/releases), open it, and drag **Rolling Pebble.app** into **Applications**.

1. Open the app and go to **Settings -> Auto Timing**.
2. Leave the runtime profile on **Auto**, then click **Create / Repair Runtime** and wait for success.
3. Choose the transcriber model in the advanced settings and click **Pre-download Model**.

The app includes Python 3.12.15, but not py-roller, audio dependencies, or model caches. These are installed into your user data directory. Installation and downloads require network access; configure a model-download HTTP/SOCKS proxy in Settings when needed. Full processing may download a separate Demucs model on its first run.

**Distribution limitation:** the DMG is ad-hoc signed and is not Apple-notarized. macOS Gatekeeper may block first launch. Do not disable system-wide security protections. This build targets Apple Silicon, not Intel Macs; the declared binary minimum is macOS 11, but dependency compatibility on older macOS releases has not been exhaustively validated.

### Command Line

The macOS arm64 desktop build includes standalone Python 3.12. It does not include `py-roller`, its audio dependencies, or model caches. Desktop users configure these from Settings; no separate Python or Homebrew installation is required. See [desktop packaging](docs/DESKTOP.md) for packaging and release-validation requirements.

For the command-line installation below, Rolling Pebble requires Python 3.10 or newer. Auto Timing additionally needs a Python 3.12 executable available on your system because the isolated `py-roller` runtime is built on Python 3.12.

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

Auto Timing uses `py-roller` for lyric alignment. Rolling Pebble does not install Torch, Demucs, faster-whisper, or other heavy audio dependencies into the main app environment. Instead, it creates a separate runtime under the app data directory.

To set it up:

1. Open **Settings -> Auto Timing -> Runtime**.
2. Choose a runtime profile.
3. Click **Create / Repair Runtime**.
4. Installation runs a runtime check automatically; **Check** can run it again later.

Then download the selected model from Settings before running Auto Timing. Environment installation and model downloads require network access. Runtime repairs keep model caches separate from the environment.

For command-line installations, if Python 3.12 is not detected automatically, set:

```bash
export LRC_ROLLER_RUNTIME_PYTHON=/path/to/python3.12
```

The current supported py-roller range is:

```text
py-roller>=0.9.0,<0.10
```

## Storage and Privacy

Rolling Pebble is local-first. It stores data under the user data directory, for example:

```text
~/.local/share/rollingpebble
```

Inside the app, **Settings -> Storage & Cleanup** shows project data, model caches, runtime environments, and other app data. Model caches are stored separately from runtime environments so they can be reused across runtime repairs.

Rolling Pebble only contacts external services when you use features that need them, such as LRCLIB lookup/publishing, supported online source import, or model downloads for Auto Timing.

## Documentation

- [User guide / 使用指南](docs/USER_GUIDE.md): temporary workspaces, saving, timing, shortcuts, export and deletion.
- [Storage and cleanup](docs/STORAGE.md): storage roots and the exact automatic-deletion behavior.
- [Development](docs/DEVELOPMENT.md) and [architecture](docs/ARCHITECTURE.md).
- [Desktop packaging](docs/DESKTOP.md) and [release checklist](docs/RELEASE.md).
- [Documentation index](docs/README.md) and [changelog](CHANGELOG.md).
