import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { BrandedQrOfferCard } from "./branded-qr-offer-card";

test("shared card renders OORO brand, campaign hierarchy, CTA and QR placeholder in preview mode", () => {
  const html = renderToStaticMarkup(React.createElement(BrandedQrOfferCard, { offer: { brandName: "Sample Café", offerTitle: "Find a new favourite", offerSubtitle: "Made for weekends", offerValue: "10% off", ctaLabel: "SCAN TO GET 10% OFF" }, previewOnly: true }));
  for (const fragment of ["data-testid=\"offer-brand-mark\">OORO", "data-testid=\"offer-merchant\">Sample Café", "data-testid=\"offer-headline\">Find a new favourite", "data-testid=\"offer-value\">10% off", "data-testid=\"offer-cta\"", "SCAN TO GET 10% OFF", "Campaign tracking QR appears when the campaign is eligible."]) assert.ok(html.includes(fragment), `missing ${fragment}`);
  assert.ok(html.indexOf("offer-brand-mark") < html.indexOf("offer-headline"));
  assert.ok(html.indexOf("offer-headline") < html.indexOf("offer-value"));
});

test("shared card never makes the staging API a consumer CTA or QR destination", () => {
  const html = renderToStaticMarkup(React.createElement(BrandedQrOfferCard, { offer: { brandName: "Sample Café", consumerUrl: "https://api-staging.theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF" }, ctaHref: "https://api-staging.theooro.com" }));
  assert.equal(html.includes("api-staging.theooro.com"), false);
  assert.ok(html.includes("data-testid=\"offer-qr-unavailable\""));
});

test("an explicitly disabled campaign QR stays absent even if stale tracking data remains", () => {
  const html = renderToStaticMarkup(React.createElement(BrandedQrOfferCard, { offer: { qrEnabled: false, consumerUrl: "https://theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF" } }));
  assert.ok(html.includes("data-testid=\"offer-qr-unavailable\""));
  assert.ok(!html.includes("data-testid=\"offer-qr\""));
});
