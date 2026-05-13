# Changelog

## 0.5.5

- Reworked the Synchronizer/Editor workspace artwork as a non-interactive background layer instead of a large image card.
- Removed the rounded green-bordered workspace avatar image from the empty Synchronizer state.
- Added a borderless workspace background asset and responsive positioning for shorter or narrower screens.

## 0.5.4

- Polished Auto Timing settings terminology and kept matching controls aligned between Settings and the main Auto Timing panel.
- Reduced processing presets to the currently supported Quick and Full flows.
- Moved model download options into their own Advanced Parameters section and removed one-click network preset buttons from the UI.
- Changed the default Auto Timing BY tag to `LRC Roller`.
- Refined the startup avatar presentation to remove the framed rounded-rectangle treatment and scale more safely on shorter displays.


## 0.5.3

- Refined isolated py-roller runtime upgrade and diagnostics behavior.
- Changed runtime creation/repair to upgrade `py-roller>=0.5.6,<0.6` when using the PyPI runtime source.
- Centralized the py-roller runtime version requirement to avoid drift between status and installer code.
- Updated `lrc-roller doctor --run-pyroller-doctor` to run doctor inside the isolated runtime instead of PATH.
- Persisted failed runtime install/check results so Settings can show the latest failure after refresh.
- Kept pip raw output in logs while preventing `install_subprocess_output` events from crowding out structured install steps.
- Added a simple guard to avoid repairing the runtime while Auto Timing is running, and to avoid starting Auto Timing during runtime repair.
- Removed redundant runtime action notices; the runtime terminal now provides the task state.

## 0.5.2

- Integrated py-roller 0.5.6 runtime install JSONL progress and JSON doctor reports.
- Changed isolated runtime creation to call `py-roller install --progress-format jsonl --output-format json`.
- Changed Runtime Check to call `py-roller doctor --output-format json`.
- Added structured runtime step rendering in Settings and moved runtime notices next to the runtime terminal.
- Folded raw runtime logs behind a details panel and included doctor/install JSON reports in diagnostics.
- Raised the isolated runtime package requirement to `py-roller>=0.5.6,<0.6`.

## 0.5.1

- Fixed isolated runtime installation failing before the installer starts when the runtime directory does not exist yet.
- Improved subprocess job error logging when a command cannot be started.

## 0.5.0 - 2026-05-13

- Moved Auto Timing to an isolated py-roller runtime virtual environment under the lrc-roller data directory.
- Changed Runtime install/repair to create or repair that isolated runtime instead of modifying the lrc-roller backend .venv.
- Changed Auto Timing command generation to call the runtime Python with `-m pyroller.cli.main`, avoiding PATH-based py-roller resolution.
- Added runtime liveness metadata to jobs, including PID, elapsed time, last output time, and return code.
- Added runtime task cancellation using process groups on POSIX systems.

## 0.4.3 - 2026-05-12

- Fixed a React hook-order crash when changing the editor metadata setting.
- Reworked the Synchronizer & Editor metadata option so it controls whether metadata tags are written into the LRC text, while keeping the metadata editor visible.
- Preserved metadata values when editing lyric text with metadata tags hidden from the text area.

## 0.4.2 - 2026-05-12

- Fixed the Recent projects limit setting so it persists and updates the project list as expected.
- Simplified Lyrics Import settings by removing automatic imported-LRC cleanup from the UI; imported lyrics now remain unchanged by default.
- Introduced an editor metadata setting, later corrected in 0.4.3 to control metadata tag writing.
- Cleaned up Auto Timing settings copy and runtime controls; runtime logs now appear directly under the runtime action buttons.

## 0.4.1 - 2026-05-12

- Reorganized Settings into General, Project, Lyrics Import, Synchronizer & Editor, Auto Timing, and Upload sections.
- Moved About out of Settings and added a dedicated About button in the header.
- Added an About dialog with project purpose, current version, credits, core hotkeys, and rights note.
- Removed the Settings subtitle line and kept only implemented settings in each section.

## 0.4.0 - 2026-05-12

- Polished the local UI ahead of the v0.4.0 milestone.
- Refined Recent Projects controls with a slimmer remove button and removed the explanatory limit line.
- Simplified Local Files import wording in Lyrics Import.
- Moved the manual LRC cleanup action into Settings and kept the Editor focused on lyrics editing.
- Unified Settings form controls, checkbox styling, fonts, focus states, and button hover states.
- Updated startup branding, browser title, manifest metadata, themed LRC circle favicon assets, and avatar-based splash animation to match LRC Roller.
- Removed the temporary splash preview page after review.
- Auto Timing task settings in Settings now save automatically instead of requiring a manual save button.
- Tightened Recent Projects row layout and improved model folder browse button styling.
- Replaced active legacy Akari image assets with LRC Roller avatar-based placeholders while keeping parser/local-storage compatibility where needed.

## 0.3.15 - 2026-05-12

- Updated Auto Timing progress parsing for py-roller 0.5.4 structured events.
- Prefer canonical `progress` values while keeping compatibility with earlier `percent` events.
- Normalize progress stages such as `preflight` and `model_download` so the stage checklist remains stable across py-roller progress protocol updates.


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
