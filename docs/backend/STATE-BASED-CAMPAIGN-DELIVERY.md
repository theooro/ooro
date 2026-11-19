# State-based campaign delivery

Campaign playback eligibility is based on authorized campaign and device state, not campaign dates or local time. A manifest contains campaigns only when the campaign is `ACTIVE`, funding is in an allowed state, an approved creative and active asset are present, the display assignment is active, and the display reports quota-capable player support.

## Offline delivery quota

Every assigned display receives a per-campaign grant with a stable grant ID, revision, and remaining plays. Finite grants are decremented atomically in the Screen Player Room database before a play starts. The receipt event ID makes retries idempotent and survives process restart. The API accounts accepted proofs against the assigned display's durable consumed-play counter. `unlimited` is false unless a Super Admin explicitly approves it; a missing quota never means unlimited delivery.

Each authenticated manifest response also grants a **15-minute offline authorization lease** (`validUntil`). Screen Player derives the remaining lease from the HTTPS response `Date` header and Android monotonic elapsed time, then stores it atomically with that manifest. A bad wall clock does not shorten or extend the lease. Process restart during the same boot preserves it; a reboot/monotonic reset invalidates it and requires a new authenticated sync. Offline playback stops when the lease expires or its play quota is exhausted, whichever comes first. Reconnecting does not extend the lease until a fresh manifest is accepted.

Quota changes are server-authorized state updates. A client merges an updated grant conservatively with its locally consumed amount. The manifest update reaches an offline display only when it next syncs. Keep grant history, proofs, and audit records; never reset local or server consumption to make a campaign eligible.

## Pauses and legacy rows

A device cannot receive a new pause/revoke while disconnected. A pause, stop, rejection, completion, or assignment removal takes effect on that device at its next successful manifest or command sync. Before then, it may play from its last authenticated manifest only until its 15-minute lease expires and while its local quota remains.

Existing dates and `AdSchedule` records are retained for audit. Migration does not convert legacy states. Administrators must review legacy scheduled records and independently confirm approval, payment/funding, active assets, assignment, and quota before changing a campaign to `ACTIVE`. No expired, rejected, unpaid, paused, or scheduled campaign is auto-activated.

## Release order

The forward-only migration `20261119120000_state_based_campaign_delivery` adds display capability and quota fields without dropping historical fields. Deploy the compatible API and schema through the approved release path, allow quota-capable devices to check in, then authorize quotas for reviewed campaigns and targeted displays. Old clients that do not report quota support receive no campaign items from the new manifest contract. Roll out compatible clients before activating new deliveries.
