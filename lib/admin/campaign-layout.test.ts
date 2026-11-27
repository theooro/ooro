import test from "node:test";
import assert from "node:assert/strict";
import { CAMPAIGN_PRESENTATION_LAYOUTS } from "./campaign-layout.js";

test("Admin campaign contract accepts the built-in MBOX preset without replacing existing layouts", () => {
  assert.deepEqual(CAMPAIGN_PRESENTATION_LAYOUTS, [
    "FULLSCREEN_AD",
    "FOUR_ZONE",
    "FOUR_ZONE_V3",
    "SPLIT_50_25_25",
    "MBOX_AD_QR_SPONSOR_V1",
  ]);
});
