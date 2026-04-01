import { test, expect } from '@playwright/test';

// Template for CI/local smoke: remove skip and point to your collector URL.
test.skip('kasm collector inputs visible', async ({ page }) => {
  const url =
    process.env.COLLECTOR_URL ||
    'https://gdtm-dev.globalsiteanalytics.com/kasm.html';
  await page.goto(url);
  await expect(page.locator('#udip')).toBeVisible({ timeout: 120000 });
  await expect(page.locator('#txId')).toBeVisible({ timeout: 120000 });
});
