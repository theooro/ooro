import { expect, test } from '@playwright/test';

const imageId = '22222222-2222-4222-8222-222222222222';
const videoId = '33333333-3333-4333-8333-333333333333';
const campaign = { id: '11111111-1111-4111-8111-111111111111', name: 'Local approved catalog', deliverySlot: 'MAIN' };

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

test('add → approved image binding → profile → save → validate shows the actual publication gate', async ({ page }, testInfo) => {
  let saved: Record<string, unknown> | undefined;
  const methods: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname; methods.push(`${request.method()} ${path}`);
    if (path.endsWith('/content')) return route.fulfill({ json: { data: { creatives: [
      { id: imageId, name: 'Approved Image', type: 'IMAGE', previewUrl: 'http://127.0.0.1:3147/approved-image.svg', campaign },
      { id: videoId, name: 'Approved Video', type: 'VIDEO', campaign },
    ], destinations: [] } } });
    if (path.endsWith('/validate')) return route.fulfill({ json: { data: { valid: false, rowVersion: 1, issues: [{ code: 'WIDGET_CERTIFICATION_REQUIRED', message: 'Image Custom hardware acceptance pending' }, { code: 'PROFILE_RESOURCE_BUDGET_UNVERIFIED', message: 'Measured MBOX resource acceptance pending' }] } } });
    if (request.method() === 'POST') { saved = request.postDataJSON(); return route.fulfill({ json: { data: { id: imageId, rowVersion: 1, state: 'DRAFT', ...saved } } }); }
    return route.fulfill({ json: { data: { layouts: [] } } });
  });
  await openLayoutStudio(page);
  await page.getByRole('button', { name: 'Widgets', exact: true }).click();
  await page.getByRole('button', { name: 'Add Image widget' }).click();
  await expect(page.getByLabel('Approved creative binding')).not.toContainText('Approved Video');
  await page.getByLabel('Approved creative binding').selectOption(imageId);
  await expect(page.getByRole('img', { name: 'Approved image: Approved Image' })).toBeVisible();
  await page.getByLabel('Target device profile').selectOption('MBOX_ANDROID10_1280_720_V1');
  await expect(page.getByTestId('selected-screen-profile')).toContainText('profile revision 1');
  await page.screenshot({ path: testInfo.outputPath('approved-image-profile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  expect(saved?.contract).toMatchObject({ profileId: 'MBOX_ANDROID10_1280_720_V1', capabilityProfileVersion: 1, screenType: 'AUTO_SCREEN', target: { width: 1280, height: 720 }, zones: [{ type: 'IMAGE', contentBinding: { kind: 'APPROVED_CREATIVE', referenceId: imageId } }] });
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

test('catalog authorization/upstream errors remain visible and retry recovers', async ({ page }) => {
  let failed = true;
  await page.route('**/api/**', route => new URL(route.request().url()).pathname.endsWith('/content')
    ? route.fulfill(failed ? { status: 403, json: { error: { message: 'Catalog access denied' }, requestId: 'req-catalog-denied' } } : { json: { data: { creatives: [], destinations: [] } } })
    : route.fulfill({ json: { data: { layouts: [] } } }));
  await openLayoutStudio(page);
  await page.getByRole('button', { name: 'Widgets', exact: true }).click(); await page.getByRole('button', { name: 'Add Image widget' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Catalog access denied' })).toContainText('HTTP 403');
  await expect(page.getByRole('alert').filter({ hasText: 'Catalog access denied' })).toContainText('req-catalog-denied');
  failed = false; await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Catalog access denied' })).toHaveCount(0);
  await expect(page.getByText(/No approved media is available for this binding/)).toBeVisible();
});

test('unsupported Weather never previews fabricated live data and widget changes reset bindings', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { data: new URL(route.request().url()).pathname.endsWith('/content') ? { creatives: [], destinations: [] } : { layouts: [] } } }));
  await openLayoutStudio(page);
  await page.getByRole('button', { name: 'Widgets', exact: true }).click(); await page.getByRole('button', { name: 'Add Weather widget' }).click();
  await expect(page.getByTestId('layout-canvas')).toContainText('No authenticated weather data source');
  await expect(page.getByTestId('layout-canvas')).not.toContainText(/\d+°/);
  await page.getByLabel('Widget type', { exact: true }).selectOption('IMAGE');
  await expect(page.getByLabel('Content binding', { exact: true })).toHaveValue('APPROVED_CREATIVE');
  await expect(page.getByLabel('Approved creative binding')).toHaveValue('');
});
