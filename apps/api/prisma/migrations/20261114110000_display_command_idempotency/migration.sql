ALTER TABLE "DisplayCommand"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "DisplayCommand_displayId_idempotencyKey_key"
  ON "DisplayCommand"("displayId", "idempotencyKey");
