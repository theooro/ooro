import { expect, test } from "@playwright/test";

const token = "abcdefghijklmnopqrstuvwxyzABCDEF";
const active = { id: "creative-1", campaignName: "Sample Campaign", campaignId: "campaign-1", creativeId: "creative-1", name: "Poster", brandName: "Sample Café", offerTitle: "A real local offer", promotionalText: "Weekends only", offerValue: "10% off", ctaLabel: "SCAN TO GET 10% OFF", consumerUrl: `https://theooro.com/go/${token}`, destinationUrl: "https://merchant.example.test/offer", state: "ACTIVE" };

test("QR scan context opens an active offer, supports manual route choices, and reports only proof-confirmed playback", async ({ page, context }) => {
  await context.grantPermissions([], { origin: "http://127.0.0.1:3137" });
  await page.route("**/api/public/qr-offers/**", route => route.fulfill({ json: { data: { state: "ACTIVE", offer: active }, error: null, requestId: "fixture" } }));
  await page.route("**/api/public/offers", route => route.fulfill({ json: { data: { offers: [active] }, error: null, requestId: "fixture" } }));
  await page.route("**/api/public/now-playing", route => route.fulfill({ json: { data: { items: [{ campaignName: "Sample Campaign", creativeName: "Poster", brandName: "Sample Café", lastReportedAt: new Date().toISOString() }], nearby: false }, error: null, requestId: "fixture" } }));
  await page.route("**/api/geocode/search?**", route => route.fulfill({ json: { data: [{ latitude: 12.9716, longitude: 77.5946, formattedAddress: "MG Road, Bengaluru", city: "Bengaluru" }] } }));
  await page.route("**/api/navigation/route", route => route.fulfill({ status: 503, json: { error: { code: "ROUTE_PREVIEW_NOT_CONFIGURED", message: "Route preview is unavailable: provider not configured." } } }));
  await page.goto(`/offer/${token}`);
  await expect(page.getByTestId("offer-headline")).toHaveText("A real local offer");
  await expect(page.getByTestId("offer-cta")).toHaveAttribute("href", "https://merchant.example.test/offer");
  await expect(page.getByRole("heading", { name: "Now playing on OORO" })).toBeVisible();
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByText(/Location was not shared/)).toBeVisible();
  await page.getByLabel("Starting point").fill("MG Road");
  await page.getByRole("option", { name: "MG Road, Bengaluru" }).first().click();
  await page.getByLabel("Drop-off location").fill("MG Road");
  await page.getByRole("option", { name: "MG Road, Bengaluru" }).last().click();
  await page.getByRole("button", { name: "Preview route" }).click();
  await expect(page.getByTestId("route-error")).toContainText("provider not configured");
  await expect(page.getByTestId("maps-handoff")).toHaveAttribute("href", /https:\/\/www\.google\.com\/maps\/dir/);
});

test("offer page distinguishes an expired scanned code from active offers", async ({ page }) => {
  await page.route("**/api/public/qr-offers/**", route => route.fulfill({ json: { data: { state: "EXPIRED", offer: null }, error: null, requestId: "fixture" } }));
  await page.route("**/api/public/offers", route => route.fulfill({ json: { data: { offers: [] }, error: null, requestId: "fixture" } }));
  await page.route("**/api/public/now-playing", route => route.fulfill({ json: { data: { items: [], nearby: false }, error: null, requestId: "fixture" } }));
  await page.goto(`/offer/${token}`);
  await expect(page.getByRole("heading", { name: "This offer has ended" })).toBeVisible();
  await expect(page.getByText("There are no active OORO offers available right now.")).toBeVisible();
});

test("nearby discovery sends only a coarse point after location permission and can stop sharing", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:3137" });
  await context.setGeolocation({ latitude: 37.4219983, longitude: -122.084 });
  let sentLocation: unknown;
  await page.route("**/api/public/qr-offers/**", route => route.fulfill({ json: { data: { state: "UNAVAILABLE", offer: null }, error: null, requestId: "fixture" } }));
  await page.route("**/api/public/offers", route => route.fulfill({ json: { data: { offers: [] }, error: null, requestId: "fixture" } }));
  await page.route("**/api/public/now-playing", async route => {
    if (route.request().method() === "POST") sentLocation = (route.request().postDataJSON() as { location?: unknown }).location;
    await route.fulfill({ json: { data: { items: [], nearby: Boolean(sentLocation) }, error: null, requestId: "fixture" } });
  });
  await page.goto(`/offer/${token}`);
  await page.getByRole("button", { name: "Find nearby · approximate location" }).click();
  await expect(page.getByText(/approximate area only/)).toBeVisible();
  expect(sentLocation).toEqual({ latitude: 37.4, longitude: -122.1 });
  await page.getByRole("button", { name: "Stop and show all verified reports" }).click();
  await expect(page.getByText(/approximate area only/)).toHaveCount(0);
});
