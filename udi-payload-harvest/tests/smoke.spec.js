import { test, expect } from '@playwright/test';

// Template for CI/local smoke: remove skip and point to your collector URL.
test.skip('collector page loads', async ({ page }) => {
  const url =
    process.env.COLLECTOR_URL ||
    'https://gdtm-dev.globalsiteanalytics.com/index.html';
  await page.goto(url);
  await expect(
    page.getByRole('button', { name: /copy\s*payload/i }),
  ).toBeVisible({ timeout: 120000 });
});
