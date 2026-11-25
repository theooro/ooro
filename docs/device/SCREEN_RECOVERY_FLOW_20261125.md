# Screen recovery repair evidence

Target: `1ee76f41-87ad-44e8-bc15-a24237d548db`.
API: `https://api-staging.theooro.com`.

## Source identity and limits

The user's original workspace is branch `sprint16/driver-real-app`, commit
`46cae78614b26e56f36dac6660dd6c6eaa69e7cc`, with extensive pre-existing edits.
That checkout builds player 0.1.0 / Room 2 and does not contain the reported
Admin recovery flow. It was not installed. Exploratory edits there were restored.
This repair uses an isolated checkout based on remote main
`81c270bf28cd607edc957f3b680039c3394f9b1a`, which contains the matching recovery
UI and player 0.2.0 / Room 6. This is source correspondence, not proof that
staging web/API deployed this commit. GitHub deployment listings did not identify
a deployed revision. The staging health paths returned HTTP 403 from this shell.

No staging Admin URL or connected authenticated browser was available. The
user identified the production Admin site and explicitly excluded it from
staging verification. Consequently the browser pairing-code Network response,
deployed web/API commits, and current staging Admin pairing status are unverified.
No recovery code was entered, issued, revealed, rotated, or revoked on staging.
No production deployment or merge was performed.

## Flow and defects

1. `ScreenDetailPage.requestRecoveryCode` calls the pairing repository, then the
   Next pairing-code proxy, then API `POST /api/displays/pairing-code`.
   The API sets `RECOVERY_REQUESTED`; this deliberately does not mean paired.
   Android `/api/device/pair` stores credentials and leaves `PAIRING_PENDING`.
   Only a heartbeat authenticated with current credentials completes `PAIRED`.
2. The repository's `getActiveCode` previously issued POST rather than reading.
   The proxy accepted malformed successful envelopes, and the repository cast
   their contents without validation. A missing code could leave `pairing` null
   and Continue Repair visible. Actual browser response remains unobserved.
   The patch validates binding, status, expiry and envelopes, gives explicit
   feedback, and adds an explicit GET reveal operation. GET never creates a
   missing code, changes pairing status, or rotates/revokes it. It requires
   `device:write`; reveal audit records only the last four characters.
3. Android pairing and confirmed unpair shared a revocation-pending marker.
   Command recovery combined that marker with any historical acknowledged
   UNPAIR receipt and could clear credentials during repair. The new marker
   distinguishes confirmed unpair and binds finalization to its command ID.
   Credential generation checks guard delayed acknowledgements; old receipts
   remain preserved. New server pairing cancels outstanding UNPAIR commands
   while keeping command history.
4. Network validation and pairing exchange now precede local authorization
   revocation. Transient request failures preserve credentials and cached state
   and schedule reconnect. Generic 404s are request errors, not proof that the
   device is unpaired. Persistent recovery retries produce the same token for
   the same device and active code rather than invalidating an earlier response.

The reported translate-page/save-page menu messages do not identify an OORO
request or stack. No connected browser was available to attribute their actual
origin. They and preload warnings were not used as root-cause evidence. The
OORO defects above are grounded in source and regression tests.

## Validation

- Admin/API production build succeeds with staging URL and live data source.
- Android staging debug APK builds with mocks disabled; 192 tests, zero failures,
  one skipped. Focused tests cover repair vs confirmed-unpair markers, retained
  credentials, historical receipts, and generic 404 handling.
- Eight focused Node/PostgreSQL tests pass, including a disposable local database
  integration test for read-only reveal, denied roles, absent codes, stable retry
  credentials, revoked/rotated codes, preserved assignments and heartbeat pairing.
  The response parser covers envelopes, wrong binding, missing code, revoked
  status, invalid expiry and expired responses. Browser UI interaction remains
  unverified because no authenticated staging browser is available.
- No Room schema or migration was changed. Disposable PostgreSQL migrations were
  applied only to local `ooro_recovery_test`, not staging or production.

## MBOX evidence

The attached MBOX initially had package `com.ooro.screenplayer`, version 0.2.0,
versionCode 2. Its APK contained the correct staging API URL. Installed and built
APK signer SHA-256:
`b280092ff7c8fe377336ec371f68efc3f66af37ad65daf83f9cdaf0ef0ab5e33`.
Room database version 6 and schema identity
`4705385ecfaa6ddd557de982120882dc` match the generated source schema.

After verifying signer and schema compatibility, `adb install -r` succeeded.
Force-stop and launch retained credentials and the target screen identity.
Room version and identity remained unchanged. The proof table had zero rows
before and after; no proof or cache reset was performed. The recent device log buffer contained accepted heartbeats and an earlier
post-install UI probe found no Continue Repair / Connect Display markers. These
log counts are not correlated to the final APK process and do not establish
final-build heartbeat acceptance. The final credential/schema read succeeded,
but final UI inspection timed out and final-process heartbeat confirmation is
unavailable. Admin PAIRED and recovery-screen acceptance remain unverified.

Cached manifest version `25239065` contains **zero items**. It cannot confirm
eligible creative playback. Current staging campaign eligibility was not
available through authorized Admin/API access. Recovery-code pairing and Admin
`PAIRED` confirmation are still blocked by that access gap; existing-credential
restart checks are not a substitute for those acceptance steps.
