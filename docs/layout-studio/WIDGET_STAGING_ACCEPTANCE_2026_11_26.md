# Layout Studio widget staging acceptance

This follow-up starts at PR #126 (`d03f4a2`) and preserves its editor feedback. It does not merge that PR, assign a layout/campaign, redeem a code, update the MBOX, or change production.

## Trace and fixes

1. The editor creates typed zones and resets incompatible binding/rotation/fit state when a widget type changes. Properties and Media list only approved creatives of the matching type and independent main/sponsor slot. Background Image can be added directly. Missing, malformed, unauthorized and non-JSON catalog responses are visible; HTTP status and a sanitized request ID are retained. Approved media without an active URL/SHA-256 checksum is explicitly reported as unavailable rather than silently disappearing.
2. Image preview uses the approved catalog asset, FIT or explicitly selected crop, and the binding name. Failed image loads are visible. Static Text previews the persisted zone label. Unsupported provider widgets say unavailable; Video is explicitly a non-playing draft preview. No placeholder is represented as a live provider.
3. Profile selection persists `profileId`, optional `capabilityProfileVersion`, `screenType`, and target width/height together inside the existing JSON contract. Changing screen type changes the matching profile; changing templates preserves the chosen profile. The canvas follows the target aspect ratio and constrains tall previews to the viewport. Old contracts without the new optional fields remain readable.
4. The API checks current creative approval, media type, slot, active asset URL and SHA-256 checksum. Drafts may preserve incomplete/unsupported work, but validation/publication requires complete applicable bindings and the source-owned certification registry. The server rechecks certification inside the publication transaction. A forged client certification object or a tampered VALIDATED row cannot unlock publication.
5. Manifest generation no longer ignores `CAPABILITY_PROFILE_UNVERIFIED`. It rechecks certification and all single/rotation/media/destination bindings against eligible, verified-metadata manifest content. A previously or manually published uncertified Custom revision is withheld; publishing a layout never creates content delivery authority.
6. Android checks the versioned MBOX contract and its candidate envelope, then matches the actual model/API/ABI/resolution/board/firmware before rendering it. Image resolves only through a screen-bound authorized manifest and downloaded checksum-verified assets; decorative Image and Text never own a paid proof slot. Hardware capability flags no longer enable Clock, Weather, Ticker or Map placeholders without runtime providers.

## Actual MBOX candidate profile

`MBOX_ANDROID10_1280_720_V1`, revision 1:

- Observed: MBOX, Android 10 / API 29, `armeabi-v7a`, 1280×720, density 213, 3,891,432 KiB RAM.
- Board hardware `sun50iw9p1`, platform `cupid`; firmware fingerprint SHA-256 `10c10aab9b732bfa48740800d877da2a3bb27d9b141b70fffae9dbb946df5cab`.
- Observed installed player versionCode 4. Candidate build versionCode 5 / `0.3.0-staging.widgets` is built but **not installed**.
- Proposed first Custom envelope: at most two zones, at most one Image plus static Text, zero video decoders and no image rotation. These are candidate limits, not measured certifications.
- Publication requires renderer, resource, offline/fallback, playback and proof-isolation evidence, with retained evidence references, for both the profile envelope and every widget. All physical Custom acceptance flags remain false. There is no request-body or environment override.

## Widget matrix

| Widget | Real runtime/data path | Publication on this MBOX profile |
| --- | --- | --- |
| Image | Approved matching creative → eligible screen manifest → checksum-verified downloaded asset → native image renderer; no decorative proof | Candidate; blocked pending Custom hardware acceptance |
| Text | Persisted zone label → bounded Compose Text; no proof | Candidate; blocked pending Custom clipping/offline/resource acceptance |
| Logo / Background Image | Existing verified image path | Outside revision 1 envelope; blocked |
| Video | Existing Media3 path and verified media binding | Zero certified Custom decoder budget; blocked |
| Main advertisement / Sponsored advertisement | Existing separately authorized campaign/proof pipelines | Outside revision 1 envelope; Custom proof/resource acceptance absent |
| QR / offer | Authorized destination carried by eligible manifest content and native QR encoder | Custom binding/resource acceptance absent; preset QR tests are insufficient |
| Clock | No Custom clock provider | `WIDGET_PROVIDER_UNAVAILABLE` |
| Weather | No authenticated weather data source or Custom provider | `WIDGET_PROVIDER_UNAVAILABLE` |
| Ticker | Preset news ticker exists, but no Custom data/runtime adapter | `WIDGET_PROVIDER_UNAVAILABLE` |
| Navigation map | Preset navigation path exists, but no certified Custom adapter/data source | `WIDGET_PROVIDER_UNAVAILABLE` |
| Static QR / External destination | No Custom native runtime adapter | Unsupported; blocked |

**Currently certified Custom publication types: none.** Image/Text implementation and local tests are not claimed as a passed physical resource/offline profile acceptance. The live assignment endpoint remains hard-disabled with `LAYOUT_ASSIGNMENT_DISABLED`.

## Checks

- API suite with the Layout Studio disposable-database integration enabled: 177 passed, 11 intentionally skipped, zero failures (188 total). The workflow tests create/bind/save/read/validate, check blocked publication and manifest eligibility, reject wrong media/checksum/profile, and verify no proof rows are created.
- Separate disposable operations integration: 1 passed; an uncertified directly seeded layout is withheld while normal unmetered campaign delivery and proof idempotency remain intact.
- Layout Studio model tests: 7 passed, including response errors, typed bindings, coherent profile selection, certification evidence requirements and fail-closed manifests.
- Browser workflows: 3 passed against a loopback-only fixture using the real editor and Tailwind styles. Tests cover add/bind/profile/save/validate, publication eligibility, template/profile preservation, portrait preview, authorization error/retry and unavailable Weather. No production authentication is relaxed or mocked; the fixture is outside all deployed Next routes.
- Android unit suite: 195 passed, 1 skipped, zero failures/errors (196 total). Lint, app build and instrumentation compilation pass locally. See PR/CI checks for the exact tested SHA. No connected MBOX instrumentation, APK installation or device mutation is performed in this task.
- Type-check, repository lint and API/Next production builds pass locally (existing lint warnings remain).
- CI enables the actual Layout Studio database integration and browser workflow tests in addition to the Android workflow. Deployment must wait for passing CI on the reviewed SHA.

Synthetic editor capture: [approved Image with selected MBOX profile](../../evidence/layout-studio-widgets-20261126/approved-image-profile.png). This is a local fixture, not evidence of a staging deployment or hardware certification.

## Database and staging release

No Prisma schema or migration files change. The new fields fit existing JSON contracts and the existing string profile column. Only fresh loopback disposable test databases were initialized for tests; no staging or production migration ran. Before any staging rollout, inspect the staging migration status through its authorized resource; do not reapply migrations blindly.

The only approved live API is `https://api-staging.theooro.com`. The operator confirmed the credential/session prerequisite, but browser discovery still returned no connected browser and the staging Admin/Coolify resource URLs have not been supplied. No deployment or deployed commit is inferred from a same-origin portal request or a health response.

After CI passes, an authorized operator must connect the staging resources, verify their environment and server-side API proxy hostname, and deploy that exact reviewed SHA to staging only. Capture the Coolify deployment receipt and deployed commit and verify API/database health plus the authorized catalog/save/validate flows. Do not repoint production or expose credentials in logs.

## Remaining hardware acceptance gate

Before marking this profile certified, retain a reviewed acceptance receipt for the exact candidate APK, signer, board/firmware and profile revision. Exercise one verified Image plus static Text at native resolution, measure decode/first-frame/memory/frame timing and sustained resource use against an approved envelope, verify offline restart and missing/corrupt/revoked asset fallback, and prove that decorative widgets and previews create no proof/impressions. A preset screenshot or a successful compilation cannot satisfy these checks.

Use an approved acceptance target/procedure that respects the instruction not to change the current MBOX before acceptance. No new APK or test package should be installed on that device until that gate is resolved. After acceptance, record the evidence in a reviewed profile revision; then revalidate publication eligibility. Live assignment still requires its separate authorized rollout and is not enabled here.
