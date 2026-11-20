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

## Spare-device acceptance plan

Run only on an approved, non-production spare with an approved production-signed Screen Player build. Capture operator, serial, board revision, firmware fingerprint, installed package/signer, pairing status, boot count, map endpoint, and lock-task/device-owner status before testing. Do not wipe, reprovision, unlock, or change ownership as part of this acceptance.

1. Confirm supplier-approved board identity and exact firmware, valid production signer lineage, and approved HTTPS map-style configuration. Verify an independent recovery/reinstall path and preserve a proof-of-play export before the test.
2. Pair the spare and confirm its existing screen identity and device credential survive an in-place signed update. Assign an approved creative with Asia/Kolkata date window and a bounded per-screen quota.
3. Verify just before start midnight it is ineligible; at and after the inclusive start date it is eligible; throughout the inclusive end date it remains eligible; at the next local midnight it is ineligible. Repeat at instants around both boundaries and compare backend manifest bounds with device diagnostics.
4. With validated internet, reboot once. Observe immediate HTTPS API sync (no three-minute wait), authenticated server `Date` acquisition, trusted-time recovery, and playback resumption. Confirm no token is present in logs.
5. Disconnect network without rebooting. Verify only still-authorized, verified cached creatives play; pairing, cached assets, manifest authorization, and queued proofs remain intact. Reboot while offline separately and confirm playback is withheld with the trusted-time unavailable message until authenticated reconnect.
6. Reconnect. Verify immediate manifest refresh, quota reconciliation, queued proof upload/acknowledgment exactly once, and resumption of eligible ads.
7. With a deliberately unreachable or invalid configured map style, verify map failure is reported and non-blocking while the ad zone continues. Restore the approved style and verify map rendering.
8. Play Standard V3 (the default), then a published custom layout. Verify geometry, z-order, image/video media, proof attribution, and all enabled widgets. The current custom contract does not define supported per-zone timed rotation or duration semantics; acceptance for those controls is blocked until the product contract is defined and implemented. Do not claim custom-layout acceptance for them.
9. Capture proof records, device/API diagnostics, map result, and operator sign-off. Restore the original approved campaign assignment/configuration and confirm a clean subsequent reboot.

## Current attached-device evidence and blockers

Read-only ADB identified serial `6c001040f441c941d94`, product `walley`, model `MBOX`, device `walleye`, Android `10` / API `29`, build ID `10.1.A36`, fingerprint `google/walley/walleye:10/QP1A.191105.004/eng.hhh.20250815.094703:userdebug/test-keys`, hardware `sun50iw9p1`, reported board `exdroid`, verified boot `green`, bootloader locked (`ro.boot.flash.locked=1`), build type `userdebug`, and tags `test-keys`. Device Policy Manager showed no owner in the inspected state; Lock Task was `NONE` with no allowlisted packages. This is not a production acceptance result, and this device was not rebooted, installed to, reset, or otherwise changed.

Physical online reboot, date-boundary playback, offline cold boot, reconnection/proof upload, map failure fallback, and custom layout playback remain unverified. Supplier confirmation that the attached `exdroid`/`cupid` identity matches the claimed H313-Q-v1.0 hardware revision is still required. The exact installed production signing identity and recovery release are not available in this checkout. The licensed production map-style endpoint and credentials were not provided; configure `OORO_MAP_STYLE_URL` or `-PmapStyleUrl` with an approved HTTPS style endpoint at staging/build time. Standard V3 remains the default. Device Owner/kiosk behavior is unverified on an approved spare. Per-zone rotation/duration semantics also require a product decision before implementation can be accepted.
