import { expect, test } from '@playwright/test';
import { addFirstPerson, detailsPanel, downloadFrom, startTree } from './fixtures';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('the app and legal pages work under the deployed security headers', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text());
  });

  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(response?.headers()['x-content-type-options']).toBe('nosniff');

  await startTree(page);
  await addFirstPerson(page, { firstName: 'Ada' });
  // Portraits are data: URLs drawn to canvas, and exports download through blob: URLs.
  await detailsPanel(page)
    .getByLabel('Choose portrait')
    .setInputFiles({ name: 'ada.png', mimeType: 'image/png', buffer: onePixelPng });
  await expect(page.getByText('Photo updated.')).toBeVisible();
  await downloadFrom(page, 'Export PNG');
  await expect(page.getByText('PNG export completed.')).toBeVisible();

  await page.goto('/privacy-policy');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(violations).toEqual([]);
});
