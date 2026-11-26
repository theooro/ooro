# Partner integration foundation (v1 contract)

## Route and model map

| Existing OORO surface | Reuse | Partner boundary needed |
| --- | --- | --- |
| `MobilityIntegration`, `MobilityEvent`, `Ride`, `RideEvent`, `RideLocation` | Internal driver app and mobility verification records | Driver-owned, provider settings. They are not a partner credential or external ingestion API. Do not share their precise history with partners. |
| `app/api/admin/campaigns/**`, campaign submission and creative submission | Admin campaign domain, approval, funding, screen assignment | Admin/session protected. Partner API must create only partner-owned drafts/submissions and must not call Admin routes with elevated rights. |
| `buildDisplayManifest`, delivery quota and proof-of-play | Authoritative activation/eligibility and proof records | Read-only partner aggregates must be scoped through campaign ownership and omit screen/passenger identifiers. |
| `CampaignTrackingLink`, `QrScan`, `/api/campaigns/:id/qr-analytics` | QR click aggregation | Existing route requires owner auth but has no partner OAuth tenant scope. Do not expose directly to partners. |
| `AuditLog`, `IdempotencyKey`, rate-limit patterns | Audit and replay design references | New partner records must include partner/environment namespace and never record bearer credentials. |
| Razorpay webhook | HMAC parsing and deduplication example | Payment event semantics/secrets are unrelated; do not reuse credentials or side effects. |

## Contract and current implementation boundary

`openapi/partner-v1.yaml` is the versioned contract. The local runtime in `apps/api/src/partner-runtime.ts` implements environment-bound OAuth tokens, Admin client and organization lifecycle, consented mobility ingestion, durable Idempotency-Key/event-ID handling, partner campaign submissions and review status, partner-owned campaign linking, aggregate inventory/delivery/QR reads, and webhook subscriptions/outbox delivery. Partner events do not create rides, campaigns, proofs or impressions. The API build and route tests do not imply deployment.

`MobilityPartnerAdapter` is a provider interface. `SyntheticMobilityAdapter` accepts only normalized sandbox fixtures. Neither class calls a real provider. Rapido/Ola/Uber remain blocked pending official partner authorization, API documentation and credentials. The OpenAPI server is a sandbox contract placeholder; no sandbox hostname, partner credentials or external partner records were provisioned.

Incoming events require `consent: true` and only allow service area (coarse label), vehicle class, aggregate trip band and approved feature. Additional fields are rejected. Event timestamps are limited to seven days old and five minutes into the future. Event IDs are unique within partner and environment. Exact duplicates are acknowledged; a different body under the same ID conflicts. Request IDs are carried in receipts for audit correlation; do not log tokens, secrets or full contextual payloads.

## OAuth and tenant rules for the service implementation

Use separate client IDs and 256-bit client secrets per partner/environment. The Admin routes persist only a one-way hash, reveal the secret on creation/rotation only, audit lifecycle actions and revoke the replaced client at rotation. Tokens are short-lived and audience-bound; current client state and scopes are checked on partner requests. Every partner query scopes to the authenticated `partnerId` and environment. Never accept partner/organization IDs from request payload as authority. Partner submissions remain `SUBMITTED`/`IN_REVIEW`/`REJECTED`; Admin linking accepts only matching, unfunded draft campaigns with approved active creatives and no active screen assignment. Approval, funding, activation and targeting remain separate Admin workflows.

Rate-limit by `(environment, partnerId)` and return 429 plus `Retry-After`. Paginate with opaque cursors and maximum page size 100. Use stable `{error:{code,message},requestId}` responses. Audit credential lifecycle, event accepted/duplicate/replay conflict, webhook subscription changes and manual retry; redact authorization and event context.

## Webhook signing and retry contract

Sign exact UTF-8 request bytes with `HMAC-SHA256(secret, timestamp + "." + body)`. Runtime sends `X-Ooro-Delivery-Id` and `X-Ooro-Signature: t=<unix-seconds>,v1=<hex>`. Consumers should persist the immutable event ID before applying effects. Webhook signing secrets are encrypted at rest; the transactional outbox records attempts, response codes and bounded exponential retry state. Only campaign submission updates and accepted normalized mobility events currently create outbox records. The standalone API worker claims rows atomically, re-resolves DNS at delivery time, pins a checked public address, rejects private/loopback/link-local/metadata ranges and redirects, and enforces time and response-size bounds. Local tests cover signatures, address policy and blocked loopback delivery; successful external delivery and every network-failure branch still need controlled sandbox acceptance.

## Sandbox, onboarding, migrations and rollback

Sandbox must be provisioned with synthetic partner and campaign fixtures, separate OAuth secrets and separate event/webhook stores. Never point sandbox credentials at staging/production. No real provider calls or live records are part of this change. Onboard only after partner agreement, privacy review, security review, data-retention schedule, scope review, webhook endpoint verification and operations owner signoff. Rapido is not connected.

The additive runtime migrations are `20261127120000_partner_integration_runtime`, `20261128150000_partner_delivery_claim` (nullable outbox claim time), `20261129100000_partner_campaign_link_unique` (one campaign can link to at most one partner submission), and `20261130120000_partner_webhook_bounded_replay` (three manual replays, each with a fresh eight-attempt budget). They were validated only against disposable local `ooro_test`, not any shared database. Before a shared deployment, identify the exact database, backup, review migration ordering and run an approved migration. Rollback should stop the worker/routes first; reset any `PROCESSING` outbox rows to `PENDING` before removing the claim column, and retain event/audit history.

## Tests

`partner-integration.test.ts` covers normalized event privacy, synthetic adapter environment rules, address policy and HMAC signature validation. `partner-runtime.integration.test.ts` runs only with `OORO_PARTNER_RUNTIME_TESTS=true` against `127.0.0.1:55432/ooro_test`; it covers OAuth/environment/scope/consent, event idempotency and concurrency, Admin credentials, campaign submission/review/link gates, tenant-scoped aggregates, outbox creation and private-address rejection. The suite does not validate live external webhooks, official aggregator APIs, a shared deployment, or production readiness.
