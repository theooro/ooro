-- Track explicit player capability reports before allowing sponsored V3 layout selection.
ALTER TABLE "Display" ADD COLUMN "supportsSponsoredSlot" BOOLEAN NOT NULL DEFAULT false;
