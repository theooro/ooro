ALTER TABLE "Display"
  ADD COLUMN "pairingStatus" TEXT NOT NULL DEFAULT 'UNPAIRED',
  ADD COLUMN "pairedAt" TIMESTAMP(3);

UPDATE "Display"
SET "pairingStatus" = 'PAIRED', "pairedAt" = "lastHeartbeatAt"
WHERE "deviceTokenHash" IS NOT NULL AND "lastHeartbeatAt" IS NOT NULL
  AND "state" NOT IN ('UNPAIRED', 'DISABLED', 'DELETED');

UPDATE "Display"
SET "pairingStatus" = 'PAIRING_PENDING'
WHERE "deviceTokenHash" IS NOT NULL AND "pairedAt" IS NULL
  AND "state" NOT IN ('UNPAIRED', 'DISABLED', 'DELETED');

UPDATE "Display"
SET "pairingStatus" = 'UNPAIRED', "pairedAt" = NULL
WHERE "deviceTokenHash" IS NULL OR "state" IN ('UNPAIRED', 'DISABLED', 'DELETED');
