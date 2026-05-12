# Changelog

## 0.3.10 - 2026-05-12

- Require `py-roller>=0.5.2` for the Hugging Face timeout environment fix.
- Normalize Hugging Face timeout and worker options as positive integers before building `py-roller` commands.
- Build `py-roller` commands from the selected stage range, only passing inputs and options that are valid for those stages.
- Persist reusable py-roller artifacts in each project under `artifacts/` so realign and rewrite-only flows can reuse prior work.
- Add Direct, Split, Realign, and Rewrite processing presets in the Auto Timing UI.
- Remove MPS from faster-whisper device choices because ctranslate2 does not accept PyTorch MPS device names.
- Render Command Preview as a scrollable terminal-style block that does not stretch the side panel.
