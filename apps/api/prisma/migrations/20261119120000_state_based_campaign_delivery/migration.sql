-- State-based delivery and bounded offline authorization. Historical campaign
-- dates and schedule/allocation records are intentionally retained for audit.
ALTER TABLE "Campaign"
  ADD COLUMN "offlinePlaysPerDisplay" INTEGER,
  ADD COLUMN "unlimitedOfflineDelivery" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "Display"
  ADD COLUMN "supportsDeliveryQuota" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "Campaign"
  ADD CONSTRAINT "Campaign_offlinePlaysPerDisplay_nonnegative"
  CHECK ("offlinePlaysPerDisplay" IS NULL OR "offlinePlaysPerDisplay" >= 0);

-- No existing campaign is activated, funded, assigned a quota, or otherwise
-- changed. Existing scheduled campaigns keep their historical state and data.

ALTER TABLE "DisplayCampaignAssignment"
  ADD COLUMN "offlinePlaysAuthorized" INTEGER,
  ADD COLUMN "offlinePlaysConsumed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "unlimitedOfflineAuthorized" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "offlineQuotaRevision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "DisplayCampaignAssignment"
  ADD CONSTRAINT "DisplayCampaignAssignment_offlinePlaysAuthorized_nonnegative"
  CHECK ("offlinePlaysAuthorized" IS NULL OR "offlinePlaysAuthorized" >= 0),
  ADD CONSTRAINT "DisplayCampaignAssignment_offlinePlaysConsumed_nonnegative"
  CHECK ("offlinePlaysConsumed" >= 0);
