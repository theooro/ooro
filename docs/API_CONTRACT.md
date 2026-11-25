# OORO device API contract

The Android player communicates outbound to the OORO API over HTTPS. The web app never connects directly to a device. Pairing codes are short-lived, one-time, random, rate-limited, and scoped to a workspace; those guarantees belong to the backend.

## Endpoints

- `POST /api/device/pair` — unauthenticated one-time pairing. Request includes `pairingCode`, `deviceId`, `manufacturer`, `model`, `androidVersion`, and `appVersion`. Response returns `deviceToken`, `screenId`, `workspaceId`, and `deviceName`.
- `GET /api/device/manifest` — bearer-authenticated, versioned manifest. A response must be validated and fully cached before activation.
- `POST /api/device/heartbeat` — bearer-authenticated health/status report.
- `POST /api/device/proof-of-play` — bearer-authenticated idempotent batch; `eventId` is the idempotency key.
- `POST /api/device/errors` — bearer-authenticated bounded diagnostic events.
- `POST /api/device/unpair` — bearer-authenticated revocation request.

Proof events include `timingVerified`. Legacy clients default to `true`; the Android player sends `false` when a persisted unlimited offline grant resumes after its authenticated monotonic time lease is unavailable. The API accepts these events idempotently but records them as `UNVERIFIED_TIME` with `OFFLINE_TIME_UNVERIFIED`; they are excluded from valid-play reporting until reconciled.

The future web flow is Screens → Add screen → backend creates a setup code → operator enters code on APK → backend binds Workspace/Screen/Device → screen appears Connected. Campaign assignments target Screen inventory, never a physical device directly.
