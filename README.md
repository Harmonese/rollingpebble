<p align="center">
  <img src="https://raw.githubusercontent.com/Harmonese/rollingpebble/main/frontend/public/favicons/apple-touch-icon.png" alt="Rolling Pebble" width="120" height="120">
</p>

# Rolling Pebble

[![PyPI](https://img.shields.io/pypi/v/rollingpebble.svg)](https://pypi.org/project/rollingpebble/)
[![Python](https://img.shields.io/badge/python-3.10%2B-3776AB.svg)](https://www.python.org/downloads/)

Rolling Pebble is a local lyrics workstation for searching, editing, timing, organizing, and publishing LRC lyrics.

It gives you a browser-based interface backed by a local Python server. Your projects, audio, lyrics, runtime environments, and model caches stay on your machine. Auto Timing is powered by `py-roller` in an isolated runtime so large audio dependencies do not pollute the main app environment.

## What It Does

- **Import** audio and lyrics from local files, LRCLIB, and supported online sources.
- **Edit** metadata and lyric text in a focused LRC editor.
- **Synchronize** timestamps manually when you want frame-level control.
- **Auto-time** lyrics with `py-roller` using isolated CPU/CUDA runtime profiles.
- **Review and clean up** projects, model caches, runtime environments, and app data.
- **Publish** prepared lyrics through LRCLIB workflows.
- **Use multiple languages** through the built-in i18n layer.

## Typical Workflow

1. Create or import a project with an audio file.
2. Import lyrics from LRCLIB, a local file, or the editor.
3. Clean up the lyric text and metadata.
4. Use the Synchronizer for manual timing, or Auto Timing for py-roller based alignment.
5. Review the generated LRC, export it, or publish it through LRCLIB.

## Install

Rolling Pebble requires Python 3.10 or newer. Auto Timing additionally needs a Python 3.12 executable available on your system because the isolated `py-roller` runtime is built on Python 3.12.

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

## First Run

Start Rolling Pebble:

```bash
rollingpebble
```

Then open:

```text
http://127.0.0.1:6789
```

The default server binds to `127.0.0.1`, so it is intended for local use.

## Auto Timing

Auto Timing uses `py-roller` for lyric alignment. Rolling Pebble does not install Torch, Demucs, faster-whisper, or other heavy audio dependencies into the main app environment. Instead, it creates a separate runtime under the app data directory.

To set it up:

1. Open **Settings -> Auto Timing -> Runtime**.
2. Choose a runtime profile.
3. Click **Create Runtime**.
4. Run **Runtime Check** after creation completes.

If Python 3.12 is not detected automatically, set:

```bash
export LRC_ROLLER_RUNTIME_PYTHON=/path/to/python3.12
```

The current supported py-roller range is:

```text
py-roller>=0.8.3,<0.9
```

## Storage and Privacy

Rolling Pebble is local-first. It stores data under the user data directory, for example:

```text
~/.local/share/rollingpebble
```

Inside the app, **Settings -> Storage & Cleanup** shows project data, model caches, runtime environments, and other app data. Model caches are stored separately from runtime environments so they can be reused across runtime repairs.

Rolling Pebble only contacts external services when you use features that need them, such as LRCLIB lookup/publishing, supported online source import, or model downloads for Auto Timing.

## Developer Notes

For source development:

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -U pip setuptools wheel
python -m pip install -e .
pnpm install
```

Run the backend and frontend together:

```bash
. .venv/bin/activate
rollingpebble dev
```

Or use two terminals:

```bash
# terminal 1
. .venv/bin/activate
rollingpebble serve --reload

# terminal 2
pnpm dev
```

Release packaging details live in [RELEASE.md](./RELEASE.md).
