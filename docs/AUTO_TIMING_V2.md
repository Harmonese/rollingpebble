# Auto Timing v2 Migration

Rolling Pebble 0.9.1 pins py-roller 0.10.3 (`6d3ded2`) and Protocol v2.

Alignment Mode is explicit in every request. New installations default to Ordered;
existing settings and historical runs without a mode retain Unordered. Ordered
requires complete lyrics with all repeats, merges timed and unresolved rows by
submitted input line index, and preserves untimed rows in review, Apply and export.
Unordered retains occurrence discovery for incomplete repetition inventories.

## Existing Data

Existing projects remain readable and LRC format is unchanged. Project saves add
structured lyric identities, translations and metadata provenance. The one-time storage
transition moves current models and results into the single application root,
rebuilds the runtime, and removes old application-owned environments and models.
There is no retained legacy configuration or permanent migration backup.
See [Storage](STORAGE.md) for transaction and cleanup behavior.

## Models

The desktop startup screen prepares bundled components on first launch and checks them on
subsequent launches. Failure offers Repair or Continue for manual editing. Settings and Start
retain the same preparation service as a fallback. Selecting Vocals prepares its optional dependencies.
Fresh installations offer Whisper large-v3, CTC and Demucs with ModelScope as the default
source, with language-based preparation selection. Existing users retain the original three-model preparation set and receive one combined issue list instead of first-install onboarding.
Installed models receive full offline SHA-256 checks on every desktop startup; missing models
in the preparation selection are reported even after intentional deletion or a previous skip; unselected new CTC models are not required. Skipping leaves unchecked
models unavailable for inference and waits for the current worker to stop. Environment checks,
model checks, downloads and final verification share one screen with stage-local progress.
Missing models do not trigger environment repair. All runs are offline.

Compatible existing environments are checked and reused. A bundle fingerprint tracks dependency
updates; failed or interrupted preparation is not considered ready. Repair rebuilds only the
managed environment, retaining projects, models, results and drafts. Diagnostics is collapsed
by default; there are no Create, Upgrade or manual Check controls.

The host model manager downloads pinned required files from ModelScope or official sources,
checks full hashes and installs into engine/models. Existing managed fixed-version weights
are adopted after verification. Advanced explicit Whisper/CTC paths remain available;
external models are checked by the engine and are never automatically repaired or removed.
Whisper large-v2 cannot replace large-v3.

Data root relocation moves the entire application root. Model removal, evidence cleanup
and result deletion are separate actions. Ordinary cache cleanup protects results and drafts
but can remove resumable downloads. Settings exposes source, HTTP(S) proxy and timeout next
to model controls; SOCKS is rejected for all model downloads. Direct mode ignores shell proxies.

## Review Workflow

Starting a single run saves the workspace once and freezes inputs. Results
belong to the run, not to the project's lyrics files. Open Auto Timing Review, review or edit,
then Apply to the workspace. Existing projects autosave the applied changes;
Save Project or Ctrl/Command+S flushes them immediately.

Preview edits survive restarts through versioned drafts. Use Latest confirms
discarding edits. Failed or cancelled results can be reviewed and explicitly
applied as Partial. Empty successful results require confirmation before
clearing lyrics. Changed audio prevents applying or retiming old results.

Batches are serial host queues. Each child has a separate reviewable result.
Runtime failures do not stop later songs; cancellation stops the current child
before releasing resources. Interrupted queues need explicit continuation.
Invalid input detected while freezing a new queue rejects creation before any
inference starts, rather than running against partially captured inputs.

## Compatibility

Language defaults to Auto, with explicit en, zh, zh-en and mul choices. Auto uses lyric text; Mandarin is not a dialect detector. English keeps its original CTC; zh/zh-en use the pinned Mandarin CTC and mul uses phoneme CTC plus bundled eSpeak NG 1.52.0. The non-English profiles are experimental and can miss lyrics. It does not expose accuracy scores or promise verified alignment.

Desktop installation currently targets macOS arm64, macOS 14+. The Python
distribution supplies the host/WebUI but not a cross-platform engine installer.
The desktop bundles the matching wheelhouse, standalone Python and FFmpeg.
Other desktop targets require their own wheel locks, binaries and validation.
