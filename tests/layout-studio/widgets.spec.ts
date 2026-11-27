import { expect, test } from '@playwright/test';

async function openLayoutStudio(page: import('@playwright/test').Page) {
  const pageErrors: string[] = [];
  const failedBundles: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === '/bundle.js') failedBundles.push(request.failure()?.errorText ?? 'bundle request failed');
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /OORO Custom/ })).toBeVisible();
  expect(pageErrors, 'fixture must mount without uncaught browser errors').toEqual([]);
  expect(failedBundles, 'fixture JavaScript bundle must load').toEqual([]);
  await page.getByRole('button', { name: /OORO Custom/ }).click();
}

test('add geometry-only image slot → choose MBOX profile → save → validate remains certification gated', async ({ page }, testInfo) => {
  let saved: Record<string, unknown> | undefined;
  const methods: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname; methods.push(`${request.method()} ${path}`);
    if (path.endsWith('/validate')) return route.fulfill({ json: { data: { valid: false, rowVersion: 1, issues: [{ code: 'WIDGET_CERTIFICATION_REQUIRED', message: 'Image Custom hardware acceptance pending' }, { code: 'PROFILE_RESOURCE_BUDGET_UNVERIFIED', message: 'Measured MBOX resource acceptance pending' }] } } });
    if (request.method() === 'POST') { saved = request.postDataJSON(); return route.fulfill({ json: { data: { id: 'layout-fixture', rowVersion: 1, state: 'DRAFT', ...saved } } }); }
    return route.fulfill({ json: { data: { layouts: [] } } });
  });
  await openLayoutStudio(page);
  await page.getByRole('button', { name: 'Widgets', exact: true }).click();
  await page.getByRole('button', { name: 'Add Image widget' }).click();
  await expect(page.getByTestId(/widget-preview-/)).toContainText('Scheduler supplies eligible, approved image media at playback.');
  await expect(page.getByText(/cannot pin a creative ID/)).toBeVisible();
  await page.getByLabel('Target device profile').selectOption('MBOX_ANDROID10_1280_720_V1');
  await expect(page.getByTestId('selected-screen-profile')).toContainText('profile revision 1');
  await page.screenshot({ path: testInfo.outputPath('scheduler-owned-image-slot.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  expect(saved?.contract).toMatchObject({ profileId: 'MBOX_ANDROID10_1280_720_V1', capabilityProfileVersion: 1, screenType: 'AUTO_SCREEN', target: { width: 1280, height: 720 }, zones: [{ type: 'IMAGE', contentBinding: { kind: 'NONE' } }] });
  expect(JSON.stringify(saved)).not.toMatch(/creativeId|referenceId/);
  await page.getByRole('button', { name: 'Check draft', exact: true }).click();
  await expect(page.getByText(/WIDGET_CERTIFICATION_REQUIRED:/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'FULLSCREEN', exact: true }).click();
  await expect(page.getByLabel('Target device profile')).toHaveValue('MBOX_ANDROID10_1280_720_V1');
  await expect(page.getByLabel('Screen type')).toHaveValue('AUTO_SCREEN');
  await page.getByLabel('Screen type').selectOption('RETAIL_EVENT');
  await expect(page.getByTestId('layout-canvas')).toHaveCSS('aspect-ratio', '1080 / 1920');
  await expect(page.getByLabel('Target device profile')).toHaveValue('OORO_RETAIL_EVENT');
  expect(methods.some(method => /proof|impression|assign|pair|heartbeat/.test(method))).toBe(false);
});

test('Layout Studio reports API errors from the real save request and allows a safe retry', async ({ page }) => {
  let failSave = true;
  await page.route('**/api/**', route => {
    const request = route.request();
    if (request.method() === 'POST') return route.fulfill(failSave
      ? { status: 503, json: { error: { message: 'Layout service unavailable' }, requestId: 'req-layout-save' } }
      : { json: { data: { id: 'layout-fixture', rowVersion: 1, state: 'DRAFT', ...request.postDataJSON() } } });
    return route.fulfill({ json: { data: { layouts: [] } } });
  });
  await openLayoutStudio(page);
  await page.getByRole('button', { name: 'Widgets', exact: true }).click();
  await page.getByRole('button', { name: 'Add Image widget' }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText(/Layout service unavailable \(HTTP 503/)).toBeVisible();
  await expect(page.getByText(/req-layout-save/)).toBeVisible();
  failSave = false;
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft saved securely.')).toBeVisible();
});

test('unsupported Weather shows no fabricated data and widget slots never expose creative binding controls', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { data: { layouts: [] } } }));
  await openLayoutStudio(page);
  await page.getByRole('button', { name: 'Widgets', exact: true }).click();
  await page.getByRole('button', { name: 'Add Weather widget' }).click();
  await expect(page.getByTestId('layout-canvas')).toContainText('No authenticated weather data source');
  await expect(page.getByTestId('layout-canvas')).not.toContainText(/\d+°/);
  await expect(page.getByLabel('Content binding', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Approved creative binding')).toHaveCount(0);
  await expect(page.getByText(/profile is not certified for the custom renderer/)).toBeVisible();
});
