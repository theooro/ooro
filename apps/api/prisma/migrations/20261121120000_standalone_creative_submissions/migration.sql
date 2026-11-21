CREATE TABLE "CreativeSubmission" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "submitterUserId" UUID NOT NULL,
  "submitterEmail" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "storageKey" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "durationSeconds" INTEGER,
  "reviewerId" TEXT,
  "reviewerRole" TEXT,
  "reviewNotes" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreativeSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CreativeSubmission_organizationId_status_createdAt_idx"
  ON "CreativeSubmission"("organizationId", "status", "createdAt");
CREATE INDEX "CreativeSubmission_submitterUserId_createdAt_idx"
  ON "CreativeSubmission"("submitterUserId", "createdAt");

ALTER TABLE "CreativeSubmission"
  ADD CONSTRAINT "CreativeSubmission_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
