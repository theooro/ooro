import { strict as assert } from "node:assert";
import { test } from "node:test";
import { canonicalConsumerQrUrl, mapBrandedOffer, offerQrSize, MIN_CONSUMER_QR_SIZE_PX } from "./offer-model";

test("branded offer mapping uses campaign fields and useful fallbacks", () => {
  const actual = mapBrandedOffer({ brandName: "Café", offerTitle: "A real offer", promotionalText: "Weekends only", offerValue: "10% off", ctaLabel: "Scan for 10%", consumerUrl: "https://theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF" });
  assert.equal(actual.brand, "Café"); assert.equal(actual.headline, "A real offer"); assert.equal(actual.supportingText, "Weekends only"); assert.equal(actual.value, "10% off"); assert.equal(actual.cta, "Scan for 10%");
  const fallback = mapBrandedOffer({}); assert.equal(fallback.brand, "A local favourite"); assert.equal(fallback.headline, "Find your next favourite"); assert.equal(fallback.cta, "SCAN TO EXPLORE");
});

test("QR targets accept only canonical public OORO tracking URLs", () => {
  const valid = "https://theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF";
  assert.equal(canonicalConsumerQrUrl(valid), valid);
  assert.equal(canonicalConsumerQrUrl("https://api-staging.theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF"), null);
  assert.equal(canonicalConsumerQrUrl("https://theooro.com.evil.test/go/abcdefghijklmnopqrstuvwxyzABCDEF"), null);
  assert.equal(canonicalConsumerQrUrl("https://theooro.com/go/not-a-token"), null);
});

test("QR sizing never recommends a symbol below scan-safe bounds", () => {
  assert.ok(offerQrSize(320, 300, 0, 24) >= MIN_CONSUMER_QR_SIZE_PX);
  assert.ok(offerQrSize(130, 100, 0, 24) < MIN_CONSUMER_QR_SIZE_PX);
});
