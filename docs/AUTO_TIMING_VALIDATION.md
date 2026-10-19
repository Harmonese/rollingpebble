# Auto Timing v2 Validation

Historical development checks below describe their dated builds, not the final
v0.8.0 artifacts. Their hashes and test counts must not be used to identify a new
release. Current distribution gates are maintained in [Release](RELEASE.md).

## Startup phase and settings audit - 2026-10-16

- 124 Python tests passed, including live Checking/Preparing phase transitions
  and protection of managed engine/Python/migration data from generic cleanup.
- Frontend typecheck, lint, Chinese localization and startup/preparation tests passed.
- Rebuilt macOS arm64 app/DMG at 0.7.4; strict deep signature and DMG verification passed.
- Current DMG SHA-256: `2817e63592ddd02a6aca655cbea41f602a8b83cbc5416d2a9935d25b26cbb51f`.
- Added indeterminate startup progress and cached settings/model state. No automated
  page tests or real inference; visual acceptance is still pending.

## Startup preparation update - 2026-10-16

The desktop now shows the existing startup animation while preparing components
on first launch or checking the existing environment on later launches. Failed
checks offer Repair or Continue; unbundled WebUI startup skips preparation.

- Python suite: 122 passed. Frontend typecheck, lint, Chinese localization and
  lyric/audio/preview/preparation tests passed. Startup component tests cover
  readiness gating, saved Vocals capability, failure, repair, Continue and cleanup.
- macOS arm64 app and DMG rebuilt at version 0.7.4. Deep strict signature checks,
  all 58 engine resource hashes and DMG integrity verification passed.
- Latest DMG SHA-256: `6c2eed3f49536acf694f9ae4c286819ff1f23e1681b0d1ffc703920f9ae4a02b`.
- No real inference, model downloads or automated page tests were performed.
  Interactive startup acceptance remains with the maintainer.

## Managed preparation update — 2026-10-16

Version remains 0.7.4. The checks below cover the subsequent automatic component
preparation and settings simplification; the real inference results later in this
document belong to the earlier build, not this update.

- Python: 121 tests passed, including 18 preparation cases. Installation behavior
  is tested with isolated temporary data and mocked subprocesses, covering model
  absence, environment reuse/rebuild, interrupted installation, request merging,
  Vocals escalation, resource exclusion and shutdown.
- Frontend: typecheck, lint, Chinese localization and existing lyric/audio/preview
  tests passed. New runtime tests cover cancellation, identity changes, one-shot
  repair and actual Start callbacks, including duplicate-click and save-order guards.
- Rust formatting and compilation tests passed (no Rust unit tests are defined).
- Final macOS arm64 app and DMG built successfully. Deep strict code-signature
  verification passed (ad-hoc signing, not notarized); all 58 engine manifest
  hashes matched, bundled Python was present, and the app version was 0.7.4.
- `hdiutil verify` passed for `Rolling Pebble_0.7.4_aarch64.dmg`.
  SHA-256: `3e39ae594e90fb59b20c1dd236dbd10ec35246a7b947cf6ae8c9127609673f36`.
- No model downloads, real inference, native runtime installation or automated
  page testing were performed for this update. Maintainer acceptance is pending.

## Earlier Engine Acceptance

Development acceptance on 2026-10-15. Application version remains 0.7.4.
Engine: py-roller 0.10.1, source commit `388dc4f`, Protocol v2.
Build host: macOS 27.2 arm64. Declared target: macOS 14+ arm64.

## Automated Checks

| Check | Result |
| --- | --- |
| Python suite | 103 passed; one upstream Starlette TestClient deprecation warning |
| Ruff, backend/tests/desktop | Passed |
| Frontend TypeScript and Oxlint | Passed |
| Chinese localization gate | Passed for zh-CN, zh-HK, zh-TW |
| Preview hook tests | Snapshot replacement, first-edit freeze, stable draft IDs, autosave, lost-response retry, restart and session isolation passed |
| Lyric marks tests | Dynamic marks, insertion/deletion undo, resets and shortcuts passed |
| Workspace audio tests | Preserved lyrics/metadata, save routing, dirty state and stale-result guards passed |
| Rust formatting and cargo test | Passed; no Rust unit tests defined |
| Frontend production build | Passed |

Protocol tests cover duplicate events, revision retraction, unknown stages,
foreign startup IDs, malformed JSON, terminal/exit conflicts, artifact identity,
path escape, timing range, empty success and LRC/alignment consistency. Service
tests cover frozen inputs, large stderr, cancellation locking, serial failure
continuation, queued cancellation, restart/draft persistence, optimistic conflicts,
disk failure, resource-lock exception cleanup, settings migration and old API 410.
Model absence is explicitly tested separately from runtime health.

## Native Evidence

The isolated source-runtime check used `output/v2-native-check`, with PATH
restricted to bundled FFmpeg and `/usr/bin:/bin`. Hashed binary installation,
runtime doctor and optional Vocals dependency installation passed. Core model
weights were migrated into isolated storage; the source cache was retained.
A separate empty Demucs directory downloaded 80.2 MiB successfully in
`output/v2-download-check`, confirming a real network model preparation path.

The 32-second `within-smoke.wav` sample and E06 plain lyrics from the adjacent
upstream artifacts were used. Results with Demucs 4.1.0:

| Operation | Result | Elapsed | Lines |
| --- | --- | --- | --- |
| Original, cancel | Cancelled; resources released after exit | 3.53 s | 0 |
| Original, retry | Completed, project unchanged | 20.16 s | 9 |
| Vocals | Completed, project unchanged | 130.24 s | 0 |

The retry reused engine evidence; its duration is not cold-run performance.
The first uncached Original run took approximately 139 seconds. Vocals returning
zero lines is valid protocol success, not evidence of good alignment quality.
No engine algorithms or research switches were modified to force output.

The first Vocals check exposed an incompatibility in Demucs 4.0.1: upstream
passes `--clip-mode none`. Pinning Demucs 4.1.0 resolved it. FFmpeg was then
replaced by a source-built, standalone LGPL 7.1 binary with its complete source,
license, checksums and build flags bundled. Native binaries were audited for
arm64, deployment targets and non-system absolute dylib dependencies.

`desktop/validate_bundle.py` runs the packaged sidecar with a fresh data root,
PATH `/usr/bin:/bin`, copied bundled Python and no developer checkout imports.
It checks the actual install/doctor/model/run/draft APIs, serving frontend assets,
cancellation, Original and Vocals inference, unchanged project files and shutdown.
It does not automate a browser or native UI. The packaged check passed in
`output/v2-bundle-check-2`: a fresh offline runtime install reported runtime ready
with models missing; doctor and Vocals dependency installation succeeded. The
bundled copied interpreter was used. Models were explicitly hard-linked from
the previous isolated acceptance directory, with no inference evidence copied.

| Packaged API operation | Result | Elapsed | Lines |
| --- | --- | --- | --- |
| Original, cancel | Cancelled | 5.79 s | 0 |
| Original, retry | Completed, no CTC/Whisper cache hits | 161.76 s | 9 |
| Vocals | Completed | 134.94 s | 0 |

The Original LRC contains four repeated phrases as separate occurrences. Final
JSON and LRC agree. Project files remained byte-for-byte unchanged; independent
draft save/read with a zero-second timestamp passed. The backend was terminated
after acceptance and its application shutdown completed.

The final rebuilt sidecar was restarted against that isolated data directory:
all three runs, the nine-line result and the version-1 edited draft were restored.
Health and draft/history APIs passed, then the test server was stopped.

## Delivered Artifacts

| Artifact | Verification |
| --- | --- |
| `src-tauri/target/release/bundle/macos/Rolling Pebble.app` | Version 0.7.4; minimum macOS 14.0; deep/strict ad-hoc signature verified |
| `src-tauri/target/release/bundle/dmg/Rolling Pebble_0.7.4_aarch64.dmg` | Image checksum verified; read-only mount contains signed app and Applications link |
| `dist/rollingpebble-0.7.4-py3-none-any.whl` | Version, current frontend and every Python module verified; no environments or engine wheelhouse |
| `dist/rollingpebble-0.7.4.tar.gz` | Current source and bundled frontend verified |

All 58 bundled engine resource hashes match their manifest, including FFmpeg
source and license. SHA-256:

```text
49f425c6c4cecfa752ca1076de21712c516db26be16739da8514c87eee8f3b17  Rolling Pebble_0.7.4_aarch64.dmg
f0321544c8b536c554d3465e071cc6c70d338edc0fad7e73d3e4b8c2bcfc80c4  rollingpebble-0.7.4-py3-none-any.whl
8fcda507cf8eb0a42f5a17868d545939212b432e2542519ef9a3ba95046da44a  rollingpebble-0.7.4.tar.gz
```

## Acceptance Limits

- No automated page or UI testing was performed, as requested. The maintainer
  still needs to inspect Preview editing, keyboard focus, confirmations and
  narrow/wide window layout in the delivered app.
- Core Whisper/CTC weights were reused through explicit isolated migration;
  their full multi-GiB cold downloads were not repeated. Demucs cold download
  was exercised. This is not a claim that every proxy/network configuration works.
- The current host is newer than the declared minimum. A macOS 14 machine and
  MPS inference remain separate acceptance checks; real inference here used CPU.
- Signing is ad-hoc integrity signing, not Developer ID signing or notarization.
- Versions, commits, tags and public releases were not changed or published.

Local logs and data live under ignored `output/` and `/tmp/rp-*.log`; they are
not production caches and are not part of the Python distributions.
