import { expect, test } from '@playwright/test';

test('built-in MBOX v1 preview shows only main, QR offer, and sponsored zones at scan-safe target geometry', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/mbox-layout-preview');
  const preview = page.getByTestId('campaign-screen-layout-preview');
  await expect(preview).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Preview layout' })).toHaveValue('MBOX_AD_QR_SPONSOR_V1');
  await expect(preview).toContainText('Main / normal ad · 65%');
  await expect(page.getByLabel('QR offer zone')).toBeVisible();
  await expect(preview).toContainText('Sponsored ad · 25% sidebar');
  await expect(preview).toContainText('Campaign tracking QR appears when the campaign is eligible.');
  await expect(preview).not.toContainText(/Navigation|Map|News ticker/);
  await expect(page.getByTestId('mbox-layout-resolution-note')).toContainText('1280×720');

  const canvas = await preview.boundingBox();
  const main = await page.getByTestId('preview-main-creative').boundingBox();
  const qr = await page.getByLabel('QR offer zone').boundingBox();
  const sponsor = await preview.getByText('Sponsored ad · 25% sidebar').boundingBox();
  expect(canvas && main && qr && sponsor).toBeTruthy();
  expect(Math.abs(main!.width / canvas!.width - 0.65)).toBeLessThan(0.01);
  expect(Math.abs(main!.height / canvas!.height - 1)).toBeLessThan(0.01);
  expect(Math.abs((qr!.x - canvas!.x) / canvas!.width - 0.65)).toBeLessThan(0.01);
  expect(Math.abs(qr!.width / canvas!.width - 0.35)).toBeLessThan(0.01);
  expect(Math.abs(qr!.height / canvas!.height - 0.75)).toBeLessThan(0.01);
  expect(Math.abs(sponsor!.height / canvas!.height - 0.25)).toBeLessThan(0.02);
  expect(pageErrors).toEqual([]);

  await page.getByRole('combobox', { name: 'Preview creative slot' }).selectOption('SPONSORED');
  const sponsoredCreative = await page.getByTestId('preview-main-creative').boundingBox();
  expect(sponsoredCreative).toBeTruthy();
  expect(Math.abs((sponsoredCreative!.x - canvas!.x) / canvas!.width - 0.65)).toBeLessThan(0.01);
  expect(Math.abs((sponsoredCreative!.y - canvas!.y) / canvas!.height - 0.75)).toBeLessThan(0.02);
  expect(Math.abs(sponsoredCreative!.width / canvas!.width - 0.35)).toBeLessThan(0.01);
  expect(Math.abs(sponsoredCreative!.height / canvas!.height - 0.25)).toBeLessThan(0.02);
});

test('existing FOUR_ZONE and OORO Standard V3 previews identify their navigation/map zones', async ({ page }) => {
  await page.goto('/mbox-layout-preview');
  const layout = page.getByRole('combobox', { name: 'Preview layout' });
  const preview = page.getByTestId('campaign-screen-layout-preview');
  await layout.selectOption('FOUR_ZONE');
  await expect(preview).toContainText('News ticker');
  await expect(preview).toContainText('QR offer');
  await expect(preview).toContainText('Navigation / map when active');
  await layout.selectOption('FOUR_ZONE_V3');
  await expect(preview).toContainText('Main / normal ad');
  await expect(preview).toContainText('Sponsored ad');
  await expect(preview).toContainText('QR offer');
  await expect(preview).toContainText('Navigation / map when active');
  await layout.selectOption('SPLIT_50_25_25');
  await expect(preview).toContainText('Main / normal ad');
  await expect(preview).toContainText('Navigation / map');
  await expect(preview).toContainText('QR offer');
  const splitCanvas = await preview.boundingBox();
  const splitNav = await page.getByTestId('preview-split-navigation-zone').boundingBox();
  const splitQr = await page.getByTestId('preview-split-qr-zone').boundingBox();
  expect(splitCanvas && splitNav && splitQr).toBeTruthy();
  expect(Math.abs(splitNav!.x - splitCanvas!.x - splitCanvas!.width * 0.5)).toBeLessThan(2);
  expect(Math.abs(splitQr!.x - splitCanvas!.x - splitCanvas!.width * 0.75)).toBeLessThan(2);
});
