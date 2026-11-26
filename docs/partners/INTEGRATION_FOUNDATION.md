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

`openapi/partner-v1.yaml` is the versioned contract. The executable domain foundation is `apps/api/src/domain/partner-integration.ts`: narrow scopes, per-environment credential validation and secret hashing, tenant filter helper, partner-specific fixed-window limiter, strict normalized consented event schema, replay window, same-ID/same-body deduplication, changed-body conflict, and timestamped HMAC webhook validation. `MobilityPartnerAdapter` is a provider interface, not a Rapido adapter. An authorized provider must implement it from official documentation and credentials after agreement.

The current foundation is not a deployed OAuth server, credential database, event ledger, campaign API, inventory query, QR endpoint, webhook subscription store, or delivery worker. OpenAPI marks these response routes 501/reserved until tenant isolation and persistence land. Sandbox hostnames are proposed contract placeholders; no DNS, sandbox credentials, partner organizations or partner data were created. This distinction prevents a contract from implying a running integration.

Incoming events require `consent: true` and only allow service area (coarse label), vehicle class, aggregate trip band and approved feature. Additional fields are rejected. Event timestamps are limited to seven days old and five minutes into the future. Event IDs are unique within partner and environment. Exact duplicates are acknowledged; a different body under the same ID conflicts. Request IDs are carried in receipts for audit correlation; do not log tokens, secrets or full contextual payloads.

## OAuth and tenant rules for the service implementation

Use separate client IDs and 256-bit client secrets per partner/environment. Persist only a one-way hash; show the secret once. Tokens should be short-lived and audience-bound to the partner API. Scopes are allowlisted and narrow. Rotation creates a new credential and can overlap only for a documented short window; revocation takes effect immediately. Every query begins with the authenticated `partnerId`, then additionally checks owned campaign/submission IDs. Never accept partner/organization IDs from request payload as authority. Campaign create means a draft only; approval, funding, activation, screen targeting and paid delivery stay in existing Admin/operations workflows.

Rate-limit by `(environment, partnerId)` and return 429 plus `Retry-After`. Paginate with opaque cursors and maximum page size 100. Use stable `{error:{code,message},requestId}` responses. Audit credential lifecycle, event accepted/duplicate/replay conflict, webhook subscription changes and manual retry; redact authorization and event context.

## Webhook signing and retry contract

Sign exact UTF-8 request bytes with `HMAC-SHA256(secret, timestamp + "." + body)`. Send `X-Ooro-Webhook-Timestamp` (Unix seconds), `X-Ooro-Webhook-Signature` (hex), and an immutable event ID. Reject timestamps outside five minutes and compare signatures in constant time. Consumers persist event ID before applying effects; retries retain the event ID and body. Planned persistence needs bounded exponential retries, per-delivery attempt records and a dead-letter/manual retry view. Signature helpers are tested; no outbound delivery worker currently exists.

## Sandbox, onboarding, migrations and rollback

Sandbox must be provisioned with synthetic partner and campaign fixtures, separate OAuth secrets and separate event/webhook stores. Never point sandbox credentials at staging/production. No real provider calls or live records are part of this change. Onboard only after partner agreement, privacy review, security review, data-retention schedule, scope review, webhook endpoint verification and operations owner signoff. Rapido is not connected.

No Prisma schema or database migration is included yet. The next implementation stage should add PartnerOrganization, PartnerClientCredential, PartnerEventReceipt, WebhookSubscription, WebhookDelivery and audit relationships in an additive migration; deploy only after an identified sandbox database and backup/rollback plan. Rollback should disable partner routes/credentials first and retain replay/audit history; do not drop event evidence or cascade-delete audit records.

## Tests

`partner-integration.test.ts` uses synthetic data only and covers strict minimization/consent and age bounds, environment isolation, hash-only credential material, rotation/revocation/expiry, scope denial, tenant filters, duplicate event delivery, changed-payload replay, rate limits, signature verification/tamper and timestamp replay. These domain tests do not claim persistence, Fastify route enforcement or production readiness.
