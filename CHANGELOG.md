# Changelog

All notable changes to this project will be documented in this file.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses Semantic Versioning.

## [Unreleased]

## [0.7.4] - 2026-10-10

### Added

- Added dynamic lyric marks with compact right-aligned numbered buttons and top-bar Mark/Unmark actions. The first ten marks support capture, insertion and removal shortcuts; repeated lyrics use the current playback time and support insertion undo.

### Changed

- Import Audio now replaces only the workspace audio, preserving lyrics, timing, marks and existing metadata. Saving replaces audio within the same project; audio changes invalidate earlier Auto Timing results.
- Synchronizer lyric rows now show matching mark numbers on the right using the mark-button style, reserving space only for marked rows.
- Repeated lyrics are inserted above the selected line while keeping the pending line selected. A transient trailing placeholder supports continued insertion after the final timestamp.
- Added `1` to select the playing lyric and `Ctrl/Cmd + Delete/Backspace` to delete a lyric line. Insertion and line deletion share chronological undo with `Ctrl/Cmd + Z`.
- Marked Auto Timing as Experimental in its panel and About descriptions.

### Fixed

- Preserved existing metadata when importing lyrics without tags, and prevented Auto Timing from starting after the workspace changes during save or preview.
- Retained draft identity across audio changes and recovered projects after a lost initial save response to avoid duplicate projects.
- Audio replacement is staged before publication, preserves the project identity, and invalidates old audio processing artifacts. Saves wait for running timing jobs before replacing their input audio.

## [0.7.3] - 2026-10-10

### Added

- Added temporary audio workspaces: importing audio no longer creates or copies a persistent project.
- Added shared React confirmation dialogs for project and storage actions so deletion works consistently in the browser and Tauri desktop app.
- Added workspace persistence tests and release documentation for project saving, cleanup and desktop validation.

### Changed

- Save Project and single-project Auto Timing now create or update the persistent project, while repeated saves reuse the existing audio.
- First-time saves publish a complete project directory and reuse a stable draft identity on retry. Import metadata is read locally without uploading audio.
- Unified the Project panel for saved and unsaved workspaces with `Project Status`, `Saved` and `Unsaved` states.
- Simplified import and project messaging, removed redundant success notices, and aligned confirmation and action buttons with the existing UI style.
- Consolidated documentation under `docs/`, updated the README and workflow guides, and retired obsolete upstream-only Docker/Vercel deployment files. Existing shortcuts and license notices are retained.

### Fixed

- Fixed stale Auto Timing results from being applied after switching or editing a workspace.
- Fixed project-list deletion and undo notifications so active workspace state and recent-project ordering stay synchronized.

### Distribution Notes

- The macOS DMG is an arm64, ad-hoc signed build and is not Apple-notarized. Gatekeeper may prevent first launch on another Mac.
- The desktop app bundles Python 3.12.15, but py-roller, audio dependencies and model caches are installed separately through Settings.

## [0.7.1] - 2026-10-08

### Added

- Bundled standalone Python 3.12.15 in the macOS Apple Silicon desktop app. Settings can create or repair the isolated runtime without system Python or Homebrew.
- Added a dedicated standalone-Python sidecar build environment and an audit of arm64 deployment targets and non-system absolute library dependencies.

### Changed

- Updated the isolated Auto Timing runtime requirement to `py-roller>=0.9.0,<0.10`.
- Updated single and batch protocol requests for py-roller 0.9, including stage-specific configuration and top-level lyrics encoding.
- Rebuilt the frontend and backend sidecar for every desktop release; keep py-roller, audio dependencies, and model caches outside the app bundle.
- Copy the bundled interpreter into the user data directory before creating the runtime, keeping environments independent of the app installation path.
- Declared macOS 11 as the arm64 binary deployment target; older macOS dependency compatibility still requires separate validation.

### Fixed

- Fixed frozen-app installer dispatch and bundled resource discovery.
- Constrained PyAV to `>=11,<19` during installation, repair, and upgrades to avoid the removed `metadata_errors` argument used by faster-whisper.
- Preserved nested install/doctor JSON reports and long protocol output lines instead of losing diagnostic and quality reports.
- Stop the desktop backend process group on normal app shutdown.

### Distribution Notes

- The macOS DMG is ad-hoc signed, not Developer ID signed or Apple-notarized. Gatekeeper may prevent first launch on another Mac.
- Environment installation and model downloads require network access. Configure an HTTP/SOCKS proxy in Settings when the model host is unreachable.
- Model pre-download caches the selected transcriber model. Full processing can additionally download Demucs on its first run.

## [0.7.0] - 2026-06-16

### Added

- Added py-roller protocol v1 contract coverage so Rolling Pebble generated run and batch requests are validated against the local py-roller parser.
- Added backend OpenAPI contract coverage for the frontend shared API routes used by settings, projects, Auto Timing, jobs, runtime, storage, and upload flows.
- Added a frontend i18n coverage checker with a Chinese-path release gate for catching untranslated Auto Timing/runtime progress labels.

### Changed

- Raised the isolated Auto Timing runtime requirement to `py-roller>=0.8.3,<0.9`.
- Reworked frontend boundaries around `app/`, `domain/`, `features/`, `ui/`, and `shared/`, removing legacy naming and old component-bucket imports.
- Reworked backend boundaries around `api/`, `services/`, `runtime/`, `storage/`, and `adapters/`, removing obsolete runtime compatibility shims.
- Hardened the Rolling Pebble to py-roller integration so the backend emits protocol v1 JSON requests instead of falling back to older CLI flag shapes.
- Improved runtime job terminal handling for install, upgrade, doctor, and model-cache jobs with localized structured messages.

### Fixed

- Fixed isolated runtime creation after an incomplete or broken managed virtual environment by rebuilding the managed `.venv` before installing dependencies.
- Fixed runtime check success rendering so successful doctor reports show runtime health details instead of only a generic success label.
- Fixed untranslated runtime completion messages such as `Runtime ready: ...`, `Task complete`, command exits, and Auto Timing progress stage labels.
- Fixed the Settings runtime warning layout so the warning icon stays inside the message box.
- Fixed packaging metadata so source distributions include the built frontend from `backend/rollingpebble/frontend_dist` instead of the old package path.

## [0.6.3] - 2026-05-21

### Added

- Added an MIT license file.
- Added a Tauri desktop packaging prototype with macOS `.app`/`.dmg` output, a bundled Python sidecar backend, generated desktop icons, and desktop packaging notes.
- Added README project icon branding.

### Changed

- Changed the README Python support badge to a static Python 3.10+ badge so it does not fail before or between PyPI metadata refreshes.
- Documented the current desktop app packaging workflow.

### Fixed

- Fixed Auto Timing model pre-download so it uses the same managed model store as normal py-roller runs.
- Fixed model pre-download to inherit the configured Hugging Face/XET/proxy/timeout download settings.
- Fixed batch Auto Timing command generation so it also uses the managed transcriber model store.

## [0.6.2] - 2026-05-20

### Changed

- Added Harmonese author information to the About dialog credits section.
- Added official website, GitHub, and Bandcamp links for Harmonese.
- Split author links and project repository links into separate rows in the About dialog.

## [0.6.1] - 2026-05-20

### Added

- Added a GitHub Actions workflow that publishes Python distributions to PyPI when a GitHub Release is published.
- Added frontend build and package-data preparation steps to the release workflow so wheels include the built WebUI.
- New `README.md` for users.

### Changed

- Converted this changelog to a Keep a Changelog style structure.
- Updated the release process documentation for GitHub Releases plus PyPI trusted publishing.

## [0.6.0] - 2026-05-20

### Added

- Initial release to GitHub Releases.
- Added a unified backend-to-frontend message i18n path and expanded UI translations across settings, runtime, storage, project, upload, and utility flows.
- Added isolated runtime dependency management and model cache controls for Auto Timing.
- Added reusable frontend primitives for modal shells, segmented tabs, panel messages, settings rows, Auto Timing fields, and settings refresh handling.
- Added storage service support for local migration, cleanup previews, app data classification, and runtime/model/project cleanup metadata.

### Changed

- Raised the isolated Auto Timing runtime requirement to `py-roller>=0.6.2,<0.8`.
- Reworked Settings with a dedicated Storage & Cleanup area, storage usage summaries, local storage location migration controls, project auto-delete settings, and safer cleanup actions.
- Improved project deletion stability, undo/restore behavior, and recent-project ordering interactions.
- Polished Synchronizer & Editor, Storage & Cleanup, Auto Timing, LRC Utilities, About, and Settings UI consistency.
- Improved toast/message lifetimes so operation-scoped messages clear when the related task completes instead of relying on fixed timeouts.
- Improved dialog and panel animations, including About, Settings, LRC Utilities, project cards, panel messages, and main UI transitions.
- Improved browser-tab/background audio handling and audio decode error reporting.

### Fixed

- Fixed the Theme Color picker focus/revert behavior.

## [0.5.5]

### Changed

- Reworked the Synchronizer/Editor workspace artwork as a non-interactive background layer instead of a large image card.
- Removed the rounded green-bordered workspace avatar image from the empty Synchronizer state.
- Added a borderless workspace background asset and responsive positioning for shorter or narrower screens.

## [0.5.4]

### Changed

- Polished Auto Timing settings terminology and kept matching controls aligned between Settings and the main Auto Timing panel.
- Reduced processing presets to the currently supported Quick and Full flows.
- Moved model download options into their own Advanced Parameters section and removed one-click network preset buttons from the UI.
- Changed the default Auto Timing BY tag to `LRC Roller`.
- Refined the startup avatar presentation to remove the framed rounded-rectangle treatment and scale more safely on shorter displays.

## [0.5.3]

### Changed

- Refined isolated py-roller runtime upgrade and diagnostics behavior.
- Changed runtime creation/repair to upgrade `py-roller>=0.5.6,<0.6` when using the PyPI runtime source.
- Centralized the py-roller runtime version requirement to avoid drift between status and installer code.
- Updated `rollingpebble doctor --run-pyroller-doctor` to run doctor inside the isolated runtime instead of PATH.
- Persisted failed runtime install/check results so Settings can show the latest failure after refresh.
- Kept pip raw output in logs while preventing `install_subprocess_output` events from crowding out structured install steps.
- Added a simple guard to avoid repairing the runtime while Auto Timing is running, and to avoid starting Auto Timing during runtime repair.
- Removed redundant runtime action notices; the runtime terminal now provides the task state.

## [0.5.2]

### Added

- Added structured runtime step rendering in Settings.
- Added doctor/install JSON reports in runtime diagnostics.

### Changed

- Integrated py-roller 0.5.6 runtime install JSONL progress and JSON doctor reports.
- Changed isolated runtime creation to call `py-roller install --progress-format jsonl --output-format json`.
- Changed Runtime Check to call `py-roller doctor --output-format json`.
- Moved runtime notices next to the runtime terminal.
- Folded raw runtime logs behind a details panel.
- Raised the isolated runtime package requirement to `py-roller>=0.5.6,<0.6`.

## [0.5.1]

### Fixed

- Fixed isolated runtime installation failing before the installer starts when the runtime directory does not exist yet.
- Improved subprocess job error logging when a command cannot be started.

## [0.5.0] - 2026-05-13

### Added

- Added runtime liveness metadata to jobs, including PID, elapsed time, last output time, and return code.
- Added runtime task cancellation using process groups on POSIX systems.

### Changed

- Moved Auto Timing to an isolated py-roller runtime virtual environment under the rollingpebble data directory.
- Changed Runtime install/repair to create or repair that isolated runtime instead of modifying the rollingpebble backend `.venv`.
- Changed Auto Timing command generation to call the runtime Python with `-m pyroller.cli.main`, avoiding PATH-based py-roller resolution.

## [0.4.3] - 2026-05-12

### Changed

- Reworked the Synchronizer & Editor metadata option so it controls whether metadata tags are written into the LRC text, while keeping the metadata editor visible.
- Preserved metadata values when editing lyric text with metadata tags hidden from the text area.

### Fixed

- Fixed a React hook-order crash when changing the editor metadata setting.

## [0.4.2] - 2026-05-12

### Added

- Introduced an editor metadata setting, later corrected in 0.4.3 to control metadata tag writing.

### Changed

- Simplified Lyrics Import settings by removing automatic imported-LRC cleanup from the UI; imported lyrics now remain unchanged by default.
- Cleaned up Auto Timing settings copy and runtime controls; runtime logs now appear directly under the runtime action buttons.

### Fixed

- Fixed the Recent projects limit setting so it persists and updates the project list as expected.

## [0.4.1] - 2026-05-12

### Added

- Added an About dialog with project purpose, current version, credits, core hotkeys, and rights note.
- Added a dedicated About button in the header.

### Changed

- Reorganized Settings into General, Project, Lyrics Import, Synchronizer & Editor, Auto Timing, and Upload sections.
- Moved About out of Settings.
- Removed the Settings subtitle line and kept only implemented settings in each section.

## [0.4.0] - 2026-05-12

### Added

- Added avatar-based startup branding, browser title, manifest metadata, themed LRC circle favicon assets, and splash animation to match LRC Roller.

### Changed

- Polished the local UI ahead of the v0.4.0 milestone.
- Refined Recent Projects controls with a slimmer remove button and removed the explanatory limit line.
- Simplified Local Files import wording in Lyrics Import.
- Moved the manual LRC cleanup action into Settings and kept the Editor focused on lyrics editing.
- Unified Settings form controls, checkbox styling, fonts, focus states, and button hover states.
- Removed the temporary splash preview page after review.
- Changed Auto Timing task settings in Settings to save automatically instead of requiring a manual save button.
- Tightened Recent Projects row layout and improved model folder browse button styling.
- Replaced active legacy Akari image assets with LRC Roller avatar-based placeholders while keeping parser/local-storage compatibility where needed.

## [0.3.15] - 2026-05-12

### Changed

- Updated Auto Timing progress parsing for py-roller 0.5.4 structured events.
- Prefer canonical `progress` values while keeping compatibility with earlier `percent` events.
- Normalize progress stages such as `preflight` and `model_download` so the stage checklist remains stable across py-roller progress protocol updates.

## [0.3.12] - 2026-05-12

### Added

- Added restricted-network Hugging Face download presets that keep SOCKS proxies and prefer `socks5h://` for remote DNS.

### Changed

- Updated model download proxy placeholders and preview warnings to catch `socks5://` misconfiguration.
- Clarified that CLI-like download defaults are for direct/public network access only.

## [0.3.11] - 2026-05-12

### Changed

- Kept Auto Timing task controls and Settings defaults in parity, including Apple Silicon/MPS visibility for Torch-based transcriber backends.
- Changed default HF model download mode to XET off for new settings.
- Reworked model download presets to match a known-good py-roller CLI style: XET off, no proxy, and py-roller default timeouts/workers.
- Added command-preview warnings for proxy, XET auto, and single-worker HF downloads.

## [0.3.10] - 2026-05-12

### Added

- Added Direct, Split, Realign, and Rewrite processing presets in the Auto Timing UI.

### Changed

- Required `py-roller>=0.5.2` for the Hugging Face timeout environment fix.
- Normalized Hugging Face timeout and worker options as positive integers before building `py-roller` commands.
- Built `py-roller` commands from the selected stage range, only passing inputs and options that are valid for those stages.
- Persisted reusable py-roller artifacts in each project under `artifacts/` so realign and rewrite-only flows can reuse prior work.
- Removed MPS from faster-whisper device choices because ctranslate2 does not accept PyTorch MPS device names.
- Rendered Command Preview as a scrollable terminal-style block that does not stretch the side panel.
