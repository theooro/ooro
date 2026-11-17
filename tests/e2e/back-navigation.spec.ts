import { expect, test } from "@playwright/test";

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test(`network onboarding has a working direct-entry back fallback on ${viewport.name}`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    // The middleware checks session-cookie presence; the network page itself does not
    // read protected account data, so this exercises only navigation and layout.
    await context.addCookies([{ name: "ooro_web_session", value: "navigation-test", domain: "127.0.0.1", path: "/" }]);
    await page.goto("/onboarding/network");

    const back = page.getByRole("button", { name: "Go back" });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  });
}

test("verification resubmission remains recoverable after a network failure", async ({ page, context }) => {
  await context.addCookies([{ name: "ooro_web_session", value: "navigation-test", domain: "127.0.0.1", path: "/" }]);
  let postAttempts = 0;
  let getAttempts = 0;
  await page.route("**/api/verification", async route => {
    if (route.request().method() === "POST") {
      postAttempts += 1;
      if (postAttempts === 1) return route.abort("timedout");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { status: "PENDING_REVIEW" } }) });
    }
    getAttempts += 1;
    const status = getAttempts > 1 ? "PENDING_REVIEW" : "NEEDS_INFORMATION";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { organization: { name: "Sample Business", type: "BUSINESS", verificationStatus: status }, request: { status, notes: status === "NEEDS_INFORMATION" ? "Please provide a business document." : null, history: [] } } }) });
  });

  await page.goto("/verification");
  const response = page.getByLabel("Your response");
  await response.fill("I have added the requested business document.");
  await page.getByRole("button", { name: "Resubmit for review" }).click();
  await expect(page.getByRole("alert")).toContainText("Check your connection");
  await expect(response).toHaveValue("I have added the requested business document.");
  await page.getByRole("button", { name: "Resubmit for review" }).click();
  await expect(page.getByRole("heading", { name: "Application received" })).toBeVisible();
  expect(postAttempts).toBe(2);
});
