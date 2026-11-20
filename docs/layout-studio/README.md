# OORO Layout Studio V1 — rollout and compatibility

## Implementation boundary

This implementation retains the original V1 layout contract lineage. Standard V3 remains the default and its geometry and delivery path are unchanged.

Layout Studio V1 provides an authenticated Standard preview and Custom draft editor, versioned normalized contract validation, persistent draft rows, immutable published revision snapshots, role checks, optimistic revision checks and audit events. Publishing a revision only publishes a presentation contract to the catalog. It does **not** approve, schedule or authorize advertising content.

The device assignment endpoint is hard-disabled in this release and always returns `LAYOUT_ASSIGNMENT_DISABLED`. There is no environment override. Assignment must not be enabled until the Android native interpreter, capability evidence, staged delivery, rollback and device acceptance work is complete. Existing V1/V2/V3 rendering and assignments are not migrated or changed.

## Standard geometry

Standard V3 is locked and resolves normalized coordinates at the target resolution. At 1280×720 it produces main 1024×612, sponsor 1024×108, QR/offer 256×360 and navigation 256×360. Its preview is visual-only. It has no access to ad impression or proof endpoints.

## Custom contract

The editor persists schema version 1 with normalized zones, whitelisted widget types, explicit FIT/CENTER_CROP behavior, content reference IDs and hardware profile labels. Optional image-zone rotation uses `rotation.version: 1`, `mode: SEQUENTIAL`, ordered unique approved non-sponsored image references, and per-item `durationSeconds` from 3 through 3600 inclusive, with a maximum of 12 items. The sequence loops in order; omitted rotation retains the existing single-binding behavior. Empty or invalid contracts fail closed. API validation rejects out-of-bounds zones, unsupported schema values, invalid bindings, invalid rotation references/durations and collisions outside supported static overlays. The declared hardware profiles are not certifications: because verified capability budgets are not registered, Custom drafts remain editable but cannot be published until the target profile's limits have test evidence. No arbitrary decoder or widget count is assumed.

Approved creative references are checked for current approval, an active asset URL and the requested MAIN/SPONSORED slot relationship when saved/validated/published. That check is a reference-integrity check, not a grant of delivery authorization. Runtime campaign eligibility, manifest leases, checksums, schedules and proof attribution remain owned by the existing advertising pipeline.

### Android interpretation and preview boundary

The Screen Player has a native Compose geometry host and strict parser for Custom contract version 1, including sequential image rotation. It accepts the low-resource zone types `MAIN_AD`, `IMAGE`, `VIDEO`, `TEXT`, `LOGO`, `QR_OFFER`, `SPONSORED_AD` and `BACKGROUND_IMAGE`. `CLOCK`, `WEATHER`, `TICKER` and `NAVIGATION_MAP` are rejected unless the caller explicitly supplies the corresponding verified device capability. Unknown schema widget types fail closed. The parser bounds a layout to 24 zones, one video, one main campaign slot, one independent sponsor slot, and at most one each of clock, weather, ticker, navigation map and QR/offer. Zone edges are rounded from normalized edges (rather than independently rounded widths), clipped to the screen and clipped within each zone; each edge differs from its unrounded value by at most 0.5 physical pixel. The browser and native geometry implementations share this rule.

The native host resolves rotated references only through the authenticated, screen-bound manifest and checksum-verified local assets. Every referenced creative must remain campaign-date eligible and have an authorized delivery quota. Custom reference zones do not create ad eligibility or proof authority; billable proof playback stays with the existing primary/sponsored slot pipeline. The backend includes a custom contract in the device manifest only when an ACTIVE, non-revoked assignment points to a PUBLISHED contract and every rotation item is in the eligible manifest. The assignment endpoint remains hard-disabled, so no operator can currently activate this path. Invalid/missing runtime references reject the whole custom contract and return to the existing Standard V3 fallback. The debug screenshot fixture is still synthetic and is not hardware or paid-ad acceptance.

Connected instrumentation must use `apps/screen-android/scripts/connected-test-safe.py` with one exact disposable AVD serial. It checks sole-device status and emulator boot/product properties before invoking Gradle. If a physical board or any ambiguous target is visible to that ADB server, the guard refuses to run; do not bypass it.

### V2 verification status

Disposable AOSP emulator screenshots are saved under `evidence/layout-studio-v2/`. Geometry assertions cover 1280×720 at runtime and shared rounding vectors cover 854×480 and 1920×1080. These x86 emulator results verify rendering geometry only; they are not ARMv7 performance evidence. Initial-frame timing, sustained frame latency, memory allocation, decoder counts and MapLibre lifecycle have not been benchmarked for Custom content. Capability certification and production content adapters remain release blockers.

## Database rollout

Migration `20261106120000_layout_studio_v1` is additive. It creates template, revision and prepared-assignment persistence; it does not backfill rows, update displays, or assign layouts. Validate and test it against a disposable database, then deploy only after review and a restorable backup. Do not apply it to staging or production as part of this code change.

## Safe activation sequence (future)

1. Validate the additive migration against a restored staging backup and apply it only with database-owner approval.
2. Release the API/web contract after migration and release review.
3. Keep live assignment hard-disabled until compatibility certification and staged rollout are complete.
4. Certify native timing, capabilities, media proof semantics and resource budgets on representative hardware.
5. Validate with synthetic previews and approved disposable devices, then perform an authorized staged rollout with rollback and audit monitoring.
6. Do not change active display assignments until explicit rollout authorization and acceptance.
