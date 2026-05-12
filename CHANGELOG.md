# Changelog

## 0.3.12 - 2026-05-12

- Added restricted-network Hugging Face download presets that keep SOCKS proxies and prefer `socks5h://` for remote DNS.
- Updated model download proxy placeholders and preview warnings to catch `socks5://` misconfiguration.
- Clarified that CLI-like download defaults are for direct/public network access only.

## 0.3.11 - 2026-05-12

- Kept Auto Timing task controls and Settings defaults in parity, including Apple Silicon/MPS visibility for Torch-based transcriber backends.
- Changed default HF model download mode to XET off for new settings.
- Reworked model download presets to match a known-good py-roller CLI style: XET off, no proxy, and py-roller default timeouts/workers.
- Added command-preview warnings for proxy, XET auto, and single-worker HF downloads.

## 0.3.10 - 2026-05-12

- Require `py-roller>=0.5.2` for the Hugging Face timeout environment fix.
- Normalize Hugging Face timeout and worker options as positive integers before building `py-roller` commands.
- Build `py-roller` commands from the selected stage range, only passing inputs and options that are valid for those stages.
- Persist reusable py-roller artifacts in each project under `artifacts/` so realign and rewrite-only flows can reuse prior work.
- Add Direct, Split, Realign, and Rewrite processing presets in the Auto Timing UI.
- Remove MPS from faster-whisper device choices because ctranslate2 does not accept PyTorch MPS device names.
- Render Command Preview as a scrollable terminal-style block that does not stretch the side panel.
