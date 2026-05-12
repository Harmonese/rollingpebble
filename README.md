# lrc-roller

Local WebUI for lyrics lookup, automatic timing, manual LRC editing, and LRCLIB publishing.

The first UI version is English-only. Internationalization will be added after the single-language workflow stabilizes.

Default ports:

- Backend/API: `http://127.0.0.1:6789`
- Vite frontend in development: `http://127.0.0.1:5173`

## Clean development setup

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -U pip setuptools wheel
python -m pip install -e .
pnpm install
```

Start both backend and frontend with one command:

```bash
. .venv/bin/activate
lrc-roller dev
```

Then open:

```text
http://127.0.0.1:5173
```

You can still run two terminals if preferred:

```bash
# terminal 1
. .venv/bin/activate
lrc-roller serve --reload

# terminal 2
pnpm dev
```

## Auto Timing runtime setup

The main workflow calls this feature **Auto Timing**. The technical engine is `py-roller`, and engine details live in **Settings -> Auto Timing Runtime** rather than the main task panel.

`pip install py-roller` installs the lightweight base package. The actual audio/transcriber stack is installed separately by py-roller because Torch/Torchaudio must match the machine profile.

Recommended wrapper:

```bash
. .venv/bin/activate
lrc-roller setup --profile auto
```

This runs:

```text
pnpm install
py-roller install --profile auto
py-roller doctor
```

For CPU-only machines:

```bash
lrc-roller setup --profile cpu
```

To inspect the current environment:

```bash
lrc-roller doctor
lrc-roller doctor --run-pyroller-doctor
```

The WebUI also provides runtime actions under Settings:

- Runtime check
- Install / repair
- Install dry run
- Copy diagnostics

## Production-like local server

Build the frontend and serve everything from the backend port:

```bash
pnpm build
lrc-roller
```

Then open:

```text
http://127.0.0.1:6789
```


## v0.3.0 notes

Auto Timing now focuses on single-song tasks with input readiness, command preview, cancel/retry controls, copied logs, project-folder opening, and a local model path field passed to py-roller as `--transcriber-model-path`.

## v0.3.4 notes

Auto Timing now exposes Hugging Face model download controls in both Settings and the per-song Advanced task parameters. These map to the latest py-roller CLI options:

- `--transcriber-hf-xet`
- `--transcriber-hf-proxy`
- `--transcriber-hf-etag-timeout`
- `--transcriber-hf-download-timeout`
- `--transcriber-hf-max-workers`
- `--transcriber-local-files-only`
- `--transcriber-model-path`

Use **Settings → Auto Timing Runtime → Use safe download defaults** when XET/CAS or high parallel downloads are unreliable on the current network.
