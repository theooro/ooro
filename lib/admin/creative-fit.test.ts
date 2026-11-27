import test from "node:test";
import assert from "node:assert/strict";
import { aspectRatioWarning, creativePlacement, THREE_ZONE_AD_SPONSOR_QR_MIN_RESOLUTION, threeZoneQrSupportsResolution } from "./creative-fit.js";

test("placement geometry fits the supported screen layouts", () => {
  for (const layout of ["FULLSCREEN_AD", "FOUR_ZONE", "FOUR_ZONE_V3", "SPLIT_50_25_25", "THREE_ZONE_AD_SPONSOR_QR_V1"] as const) {
    const region = creativePlacement(layout);
    assert.ok(region.x >= 0 && region.y >= 0 && region.x + region.width <= 1 && region.y + region.height <= 1);
  }
  assert.equal(creativePlacement("SPLIT_50_25_25").width, 0.5);
  assert.equal(creativePlacement("SPLIT_50_25_25").aspectRatio, 8 / 9);
  assert.equal(creativePlacement("FOUR_ZONE_V3").width, 0.8);
  assert.equal(creativePlacement("FOUR_ZONE_V3").height, 0.85);
  assert.equal(creativePlacement("FOUR_ZONE_V3", "SPONSORED").y, 0.85);
  assert.equal(creativePlacement("FOUR_ZONE_V3", "SPONSORED").height, 0.15);
  assert.deepEqual(creativePlacement("THREE_ZONE_AD_SPONSOR_QR_V1"), { x: 0, y: 0, width: 0.65, height: 1, aspectRatio: 1.1555555555555554 });
  assert.equal(creativePlacement("THREE_ZONE_AD_SPONSOR_QR_V1", "SPONSORED").aspectRatio, (16 / 9) * 1.4);
  assert.deepEqual(THREE_ZONE_AD_SPONSOR_QR_MIN_RESOLUTION, { width: 1280, height: 720 });
  assert.equal(threeZoneQrSupportsResolution(1280, 720), true);
  assert.equal(threeZoneQrSupportsResolution(1024, 600), false);
  assert.equal(threeZoneQrSupportsResolution(720, 1280), true, "landscape player orientation normalizes portrait-reported display metrics");
});

test("fit warnings cover portrait, square, and ultrawide creatives", () => {
  const target = creativePlacement("FULLSCREEN_AD").aspectRatio;
  assert.equal(aspectRatioWarning(1920, 1080, target), null);
  for (const [width, height] of [[1080, 1920], [1000, 1000], [3840, 800]]) assert.match(aspectRatioWarning(width, height, target) ?? "", /letterboxing/);
});
