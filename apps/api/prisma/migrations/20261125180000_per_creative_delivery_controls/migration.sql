ALTER TABLE "Creative"
ADD COLUMN "deliverySlot" TEXT;

ALTER TABLE "Creative"
ADD CONSTRAINT "Creative_deliverySlot_check"
CHECK ("deliverySlot" IS NULL OR "deliverySlot" IN ('MAIN', 'SPONSORED'));
