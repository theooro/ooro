ALTER TABLE "CreativeSubmission" ADD COLUMN "scheduledCreativeId" UUID;
CREATE UNIQUE INDEX "CreativeSubmission_scheduledCreativeId_key" ON "CreativeSubmission"("scheduledCreativeId");
ALTER TABLE "CreativeSubmission" ADD CONSTRAINT "CreativeSubmission_scheduledCreativeId_fkey" FOREIGN KEY ("scheduledCreativeId") REFERENCES "Creative"("id") ON DELETE SET NULL ON UPDATE CASCADE;
