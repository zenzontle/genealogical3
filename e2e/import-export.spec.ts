import { expect, test, type Page } from '@playwright/test';
import {
  addFirstPerson,
  addRelative,
  backToWorkspace,
  detailsPanel,
  downloadedBytes,
  downloadFrom,
  expectCounts,
  expectSaved,
  openTree,
  renameTree,
  selectPerson,
  startTree,
} from './fixtures';

async function buildTree(page: Page) {
  await startTree(page);
  await addFirstPerson(page, { firstName: 'Marie', lastName: 'Curie' });
  await detailsPanel(page).getByLabel('Notes').fill('Physicist and chemist.');
  await addRelative(page, 'Partner', { firstName: 'Pierre', lastName: 'Curie' });
  await addRelative(page, 'Child', { firstName: 'Irène', lastName: 'Joliot-Curie' });
  await renameTree(page, 'My family tree', 'Curie family');
  await expectSaved(page);
}

const parseJson = async (bytes: Buffer) => JSON.parse(bytes.toString('utf8'));

test('a JSON export imports as an identical copy', async ({ page }) => {
  await buildTree(page);
  const exported = await downloadFrom(page, 'Export JSON');
  expect(exported.suggestedFilename()).toBe('Curie-family.json');
  const original = await parseJson(await downloadedBytes(exported));
  expect(original.name).toBe('Curie family');
  expect(original.people).toHaveLength(3);
  expect(original.relations).toHaveLength(2);

  await backToWorkspace(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (await chooser).setFiles(await exported.path());
  await expect(page.getByText('Imported Curie family (imported).')).toBeVisible();
  // The original stays alongside the copy.
  await expect(page.getByRole('button', { name: 'Open Curie family', exact: true })).toBeVisible();

  await openTree(page, 'Curie family (imported)');
  await expectCounts(page, 3, 2);
  await selectPerson(page, 'Marie Curie');
  await expect(detailsPanel(page).getByLabel('Notes')).toHaveValue('Physicist and chemist.');

  const copy = await parseJson(await downloadedBytes(await downloadFrom(page, 'Export JSON')));
  expect(copy.id).not.toBe(original.id);
  expect(copy.name).toBe('Curie family (imported)');
  expect(copy.homePersonId).toEqual(original.homePersonId);
  expect(copy.people).toEqual(original.people);
  expect(copy.relations).toEqual(original.relations);
});

test('PNG export downloads a rendered image', async ({ page }) => {
  await buildTree(page);
  const download = await downloadFrom(page, 'Export PNG');
  // Success toasts dismiss themselves after 5 s, so check it before reading the file.
  await expect(page.getByText('PNG export completed.')).toBeVisible();
  expect(download.suggestedFilename()).toBe('Curie-family.png');
  const bytes = await downloadedBytes(download);
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  // IHDR follows the signature: width and height of a canvas with three cards.
  expect(bytes.readUInt32BE(16)).toBeGreaterThan(100);
  expect(bytes.readUInt32BE(20)).toBeGreaterThan(100);
});

test('PDF export downloads a print-ready document', async ({ page }) => {
  await buildTree(page);
  const download = await downloadFrom(page, 'Export PDF');
  await expect(page.getByText('PDF export completed.')).toBeVisible();
  expect(download.suggestedFilename()).toBe('Curie-family.pdf');
  const text = (await downloadedBytes(download)).toString('latin1');
  expect(text.startsWith('%PDF-1.4\n')).toBe(true);
  // Three cards fit on one page; the page is a JPEG drawn by the browser's canvas.
  expect(text).toContain('/Type /Pages /Count 1 ');
  expect(text).toContain('/Filter /DCTDecode');
  expect(text).toContain('stream\n\xff\xd8\xff');
  expect(text).toContain('/Title <FEFF');
  expect(text.endsWith('%%EOF\n')).toBe(true);
});
