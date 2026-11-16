ALTER TABLE "DisplayPairingCode"
ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'SCREEN_PLAYER';

CREATE INDEX "DisplayPairingCode_displayId_purpose_expiresAt_idx"
ON "DisplayPairingCode"("displayId", "purpose", "expiresAt");
