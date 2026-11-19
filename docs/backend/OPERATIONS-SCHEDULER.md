# Campaign scheduling retirement

Date-, weekday-, and daily-window-based campaign scheduling is retired. The old protected scheduler page redirects to campaign administration, and its check/publish API routes no longer create schedules or inventory allocations. The compatibility data endpoint at `/api/admin/scheduler` returns screen-group and network data only; schedule collections are empty.

Historical `AdSchedule`, campaign date, and inventory allocation rows remain in PostgreSQL for audit. They are not read by manifest generation and are not automatically converted into active delivery. In particular, legacy `SCHEDULED`, expired, unpaid, unapproved, paused, rejected, and completed campaigns retain their current states until an authorized administrator reviews them.

Use the campaign state and quota administration flow. Delivery manifests include only campaigns in `ACTIVE` state with approved creative assets, recognized funding, an active screen assignment, and an explicit finite per-screen quota or a Super Admin-approved unlimited grant. A pause or stop is applied to an offline screen at its next successful manifest or command sync.

The additive migration `20261119120000_state_based_campaign_delivery` adds quota-capability and per-screen grant/accounting fields. It does not drop historical data or backfill campaign states, assignments, funding, or quotas. Review and deploy the API and migration through the authorized release process; then review eligible legacy campaigns and authorize quotas per screen. Do not run the migration against staging or production without the database owner and release operator's approval.
