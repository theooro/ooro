# Screen Player date and reboot acceptance

## Delivery dates

Campaign delivery uses inclusive calendar dates in `Asia/Kolkata` (`UTC+05:30`). The admin form accepts a start date and end date only. The API converts the start to local midnight and the end to midnight after the selected end date, then stores a half-open UTC interval. Thus every instant on both selected local dates is eligible. Backend manifests carry the resulting UTC `startAt` and exclusive `endAt` instants; Android uses those bounds and ignores legacy day-of-week and time-of-day fields. Approval, funding, targeting, quotas, creative verification, and proof attribution remain separate requirements.

Trusted schedule time is mandatory. Android derives it from the authenticated HTTPS response `Date` header and monotonic elapsed time. Device wall-clock time is not used for campaign eligibility. A persisted authorization is boot-bound; after reboot, it is invalidated until a new authenticated response arrives. A validated network callback triggers an immediate sync attempt, while the existing three-minute manifest refresh remains enabled. DNS, TLS, API connectivity, authentication, and invalid/missing/expired/backwards server-time failures are surfaced without logging credentials.

## Offline reboot behavior

On the MBOX Android 10/API 29 device, elapsed realtime and the persisted boot count cannot establish a trusted date after a reboot without a new authenticated server response. We do not use Android wall-clock time as a substitute. Offline cold boot therefore fails closed for date-sensitive campaign playback until connectivity returns; cached media and pairing/proof data remain stored. Within the already-authorized same-boot lease, offline playback continues under the existing bounded policy.

## Code-level verification

- API campaign date conversion tests cover inclusive start and end instants, exclusive next midnight, Asia/Kolkata UTC conversion, invalid dates/ranges, and invalid timezones.
- Android tests cover UTC date boundaries and the boot-count invalidation/HTTPS-time renewal path.
- Android unit tests/build and backend/web checks are run from the feature branch. These do not establish physical playback or device capability.

## Custom zone rotation contract (code support; device acceptance blocked)

Layout Studio contract version 1 adds optional per-zone `rotation: { version: 1, mode: "SEQUENTIAL", items: [{ referenceId, durationSeconds }] }`. The ordered list loops from first to last and repeats. Durations are whole seconds from 3 through 3600 inclusive. At most 12 distinct items are accepted. Rotation is supported only on unbound `IMAGE` zones; every reference must resolve to an approved, available, non-sponsored image creative. At playback, each item must also be in the authenticated manifest, checksum-verified, eligible under its campaign date window and delivery quota. The renderer uses each configured duration. Missing, unauthorized, expired, or unverified rotation media rejects the whole custom contract for that manifest and Standard V3 remains the playback fallback. An omitted rotation keeps the existing single binding behavior. Standard V3 is unchanged.

Custom contracts persist as JSON in the existing layout draft/revision records. A non-revoked ACTIVE assignment to a PUBLISHED custom revision is serialized into the authenticated device manifest. The assignment API remains hard-disabled pending certified device resource limits, staged rollout, and physical acceptance; operators cannot schedule a live custom layout in this release. A layout reference does not grant ad eligibility or proof authority. Implementation is code-level only; custom playback, timing, and proof attribution on the MBOX remain unverified.

## Licensed map provider setup

Production map acceptance is **BLOCKED** because no provider, credentials, or licensed endpoint was supplied. The operator must supply the provider's HTTPS MapLibre-compatible style JSON URL; a client credential only if required and approved for embedding in a distributed app; attribution text; license terms covering display count, geography, traffic, caching/offline behavior and commercial use; and quota/token expiry and rotation limits. Do not embed a provider secret that must remain confidential in an APK. Configure the approved URL through masked build environment variable `OORO_MAP_STYLE_URL` (or Gradle `-PmapStyleUrl` in a controlled build job); never commit a credential-bearing value. Confirm the final style URI is HTTPS and has no user-info. Public OpenStreetMap tile endpoints are not a licensed production substitute. With no valid configured style, the map panel reports “Map unavailable · ads continue”; map tile/style errors are isolated from the ad zone. Fallback has code tests only, not physical provider acceptance.

## Spare-device acceptance plan

Run only on an approved, non-production spare with an approved production-signed Screen Player build. Capture operator, serial, board revision, firmware fingerprint, installed package/signer, pairing status, boot count, map endpoint, and lock-task/device-owner status before testing. Do not wipe, reprovision, unlock, or change ownership as part of this acceptance.

1. Confirm supplier-approved board identity and exact firmware, valid production signer lineage, and approved HTTPS map-style configuration. Verify an independent recovery/reinstall path and preserve a proof-of-play export before the test.
2. Pair the spare and confirm its existing screen identity and device credential survive an in-place signed update. Assign an approved creative with Asia/Kolkata date window and a bounded per-screen quota.
3. Verify immediately before start-date local midnight it is ineligible; from the inclusive start date through the inclusive end date it is eligible; at the next local midnight it is ineligible. Capture at least one instant just before and after both boundaries and compare backend manifest bounds with device diagnostics. Use Asia/Kolkata for campaign dates.
4. With validated internet, reboot once. Observe immediate HTTPS API sync (no three-minute wait), authenticated server `Date` acquisition, trusted-time recovery, and playback resumption. Confirm no token is present in logs.
5. Disconnect network without rebooting. Verify only still-authorized, verified cached creatives play; pairing, cached assets, manifest authorization, and queued proofs remain intact. Reboot while offline separately and confirm playback is withheld with the trusted-time unavailable message until authenticated reconnect.
6. Reconnect. Verify immediate manifest refresh, quota reconciliation, queued proof upload/acknowledgment exactly once, and resumption of eligible ads.
7. With an intentionally unreachable or invalid configured map style, verify map failure is reported and non-blocking while the ad zone continues. Restore the licensed style and verify rendering, attribution and token policy.
8. Play Standard V3 and confirm it remains the default. Once a profile is certified and custom assignment is explicitly enabled in a later release, play a custom layout and verify geometry, z-order, an ordered two-image rotation at configured 3-second and longer durations, eligibility, proof attribution for billable slots, and safe fallback for missing/invalid rotation media. Do not enable assignment in this release.
9. Verify login/pairing survives reboot and in-place update. Record Device Owner, Lock Task, HOME/default-launcher and boot-start behavior as observed; do not infer kiosk support from OEM unlocking. Enrollment/reset/settings changes need a separate approved plan.
10. Capture proof records, diagnostics, map result and operator sign-off. Restore the approved campaign assignment/configuration and confirm a clean subsequent reboot.

## Current attached-device evidence and blockers

Read-only ADB identified serial `6c001040f441c941d94`, product `walley`, model `MBOX`, device `walleye`, Android `10` / API `29`, build ID `10.1.A36`, fingerprint `google/walley/walleye:10/QP1A.191105.004/eng.hhh.20250815.094703:userdebug/test-keys`, hardware `sun50iw9p1`, reported board `exdroid`, verified boot `green`, bootloader locked (`ro.boot.flash.locked=1`), build type `userdebug`, and tags `test-keys`. Device Policy Manager showed no owner in the inspected state; Lock Task was `NONE` with no allowlisted packages. This is not a production acceptance result, and this device was not rebooted, installed to, reset, or otherwise changed.

Physical online reboot, offline cold boot, date-boundary playback, reconnection/proof upload, map fallback, Standard V3/custom playback, and login/kiosk behavior are **NOT TESTED** in this task. Attached-device data is historical read-only evidence; no new physical checks were performed. An approved spare/device is unavailable. Supplier confirmation of exact board revision and firmware is required. Production signer and same-signer recovery release are unavailable. Device Owner enrollment and silent installation remain unverified. No licensed production map endpoint/token/license was supplied. Custom assignment remains disabled until hardware resource limits, billing/proof behavior, staged rollback and physical acceptance are certified.

## Operator inputs required to resume

1. Supplier confirmation tying the spare's serial, exact board revision and firmware fingerprint to the supported MBOX build.
2. Approved production signing identity/lineage, installed Screen Player certificate fingerprints and a tested same-signer recovery release.
3. Approved spare with a restorable data/firmware recovery route and written approval for the exact test procedure.
4. OEM/EMM Device Owner enrollment instructions for this firmware, including factory-reset and data-erasure implications.
5. Licensed MapLibre-compatible HTTPS style endpoint, provider-approved distributed-client credential if needed, attribution and usage/license terms.
6. Operator approval of image-zone rotation and proof/billing semantics, plus target-hardware capability measurement and staged custom-layout rollout criteria.

Until those inputs are available, physical checks are blocked/not tested and PR #109 remains a draft. No staging or production changes were made.
