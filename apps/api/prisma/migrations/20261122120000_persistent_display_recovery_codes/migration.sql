CREATE TABLE "DisplayRecoveryCode" (
  "id" UUID NOT NULL,
  "displayId" UUID NOT NULL,
  "codeHash" TEXT NOT NULL,
  "encryptedCode" TEXT NOT NULL,
  "codeLast4" TEXT NOT NULL,
  "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DisplayRecoveryCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DisplayRecoveryCode_displayId_key" ON "DisplayRecoveryCode"("displayId");
CREATE UNIQUE INDEX "DisplayRecoveryCode_codeHash_key" ON "DisplayRecoveryCode"("codeHash");
ALTER TABLE "DisplayRecoveryCode" ADD CONSTRAINT "DisplayRecoveryCode_displayId_fkey" FOREIGN KEY ("displayId") REFERENCES "Display"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PairingAttemptBucket" (
  "key" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "blockedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PairingAttemptBucket_pkey" PRIMARY KEY ("key")
);
