# OORO DeviceOS Agent

Standalone Kotlin agent with application ID `com.ooro.deviceagent`.

## Build

```bash
# The repository's existing Android Gradle wrapper can build this standalone project.
apps/screen-android/gradlew -p apps/deviceos-android testDebugUnitTest assembleDebug
apps/screen-android/gradlew -p apps/deviceos-android -PdeviceApiBaseUrl=https://api.example.invalid assembleRelease
```

The release build requires an HTTPS API URL. The placeholder above is only for compilation; it is not a deployable endpoint.

## Operating mode

The first release is non-owner observation mode. It enrolls through an existing OORO display pairing code, stores the DeviceOS credential in Android Keystore-backed storage, reports package certificate inventory plus memory, storage, network, processor count, and `/proc/loadavg` CPU-load telemetry where available, and schedules WorkManager reconciliation.

## Connect an existing OORO screen

1. In the admin console, open **DeviceOS** and choose the paired screen under **Connect your first device**. Create a DeviceOS enrollment code. It expires after ten minutes and is separate from the Screen Player pairing code.
2. Install the approved OORO DeviceOS Agent on the Android board, make sure it can reach the configured API, open **OORO DeviceOS**, enter the code, and tap **Enroll agent**. Successful enrollment stores a device credential in Android Keystore and the device should appear under **Devices** after its first check-in.
3. Register the target package in **Applications**, upload the signed APK in **Releases**, verify its package, version and signing certificate, and have a Super Admin approve it.
4. Create a deployment, select the approved release and enrolled screen, review rollout safeguards, then create the deployment. The agent polls while online. In observation mode Android may require an on-device user confirmation; do not expect silent installation.

Enrollment codes are single-use, short-lived credentials. Do not screenshot, paste into tickets, or send them to an unverified person. The admin endpoint records who issued each code. A Screen Player code cannot enroll DeviceOS, and a DeviceOS code cannot pair the Screen Player.

The agent declares a `DeviceAdminReceiver` and detects Device Owner status, but does not assign ownership, reset the device, enable Lock Task, or claim silent-install capability. `PackageInstaller` uses supported Android behavior; `STATUS_PENDING_USER_ACTION` is surfaced to the user.

APK validation checks the server-provided SHA-256, package name, version code, minSdk, and signing certificate on API 26–35. API 26–27 use the supported legacy signing metadata path and reject certificate mismatches.

If the backend returns HTTP 401 for an expired or revoked credential, the agent clears its Keystore-backed credential and stops synchronization. Re-enrollment with a new OORO pairing code is then required; credentials are never regenerated silently.

An enrolled operator can use the explicit “Rotate stored credential” action in the agent to replace its credential transactionally. Rotation is not automatic, so transient connectivity failures cannot strand the device with an unknown replacement token.

Heartbeat and credential-rotation requests include a fresh UUID `requestId`. The API stores a bounded per-device receipt for seven days and does not apply a repeated heartbeat; a repeated rotation request is rejected rather than creating another credential.
