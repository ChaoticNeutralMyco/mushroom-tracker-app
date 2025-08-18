import { test, expect } from '@playwright/test';

test('PWA manifest is served (base-aware)', async ({ page, request, baseURL }) => {
  // Load the app at whatever baseURL points to.
  await page.goto('./');

  // Read the exact manifest href from the document.
  const href = await page.locator('link[rel="manifest"]').first().getAttribute('href');
  expect(href, 'No <link rel="manifest"> on the page').not.toBeNull();

  // Resolve it against baseURL so subpaths are handled correctly.
  const manifestURL = new URL(href!, baseURL).toString();
  const res = await request.get(manifestURL);
  expect(res.ok(), `Failed to GET manifest at ${manifestURL}`).toBeTruthy();

  const json = await res.json();
  expect(json).toHaveProperty('name');
  expect(json).toHaveProperty('icons');
});
