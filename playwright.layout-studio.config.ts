import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/layout-studio', workers: 1, retries: 0,
  use: { baseURL: 'http://127.0.0.1:3147', headless: true, viewport: { width: 1600, height: 1000 } },
  outputDir: 'test-results/layout-studio',
  webServer: { command: 'node scripts/layout-studio-test-server.mjs', url: 'http://127.0.0.1:3147', reuseExistingServer: false },
});
