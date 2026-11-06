import { expect, test, type Page } from '@playwright/test';
import {
  addFirstPerson,
  addRelative,
  backToWorkspace,
  detailsPanel,
  expectCounts,
  expectSaved,
  openTree,
  personCard,
  renameTree,
  selectPerson,
  startTree,
} from './fixtures';

async function buildFamily(page: Page) {
  await startTree(page);
  await addFirstPerson(page, { firstName: 'Rose', lastName: 'Fitzgerald' });
  await addRelative(page, 'Partner', { firstName: 'Joseph', lastName: 'Kennedy' });
  await selectPerson(page, 'Rose Fitzgerald');
  await addRelative(page, 'Child', { firstName: 'Eunice', lastName: 'Kennedy' });
  await expectCounts(page, 3, 2);
  await expectSaved(page);
}

async function confirmDelete(page: Page, title: string) {
  const dialog = page.getByRole('dialog', { name: title });
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function expectRestoredAfterReload(page: Page, treeName: string) {
  await expectSaved(page);
  await page.reload();
  await openTree(page, treeName);
  await expectCounts(page, 3, 2);
  for (const name of ['Rose Fitzgerald', 'Joseph Kennedy', 'Eunice Kennedy'])
    await expect(personCard(page, name)).toBeVisible();
}

test('undo restores a deleted person and their relationships', async ({ page }) => {
  await buildFamily(page);
  await selectPerson(page, 'Rose Fitzgerald');
  await detailsPanel(page).getByRole('button', { name: 'Delete person' }).click();
  await confirmDelete(page, 'Delete person?');
  await expectCounts(page, 2, 0);
  await expect(personCard(page, 'Rose Fitzgerald')).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expectCounts(page, 3, 2);
  await expectRestoredAfterReload(page, 'My family tree');
});

test('undo restores a deleted group selection', async ({ page }) => {
  await buildFamily(page);
  await selectPerson(page, 'Joseph Kennedy');
  await personCard(page, 'Eunice Kennedy').click({ modifiers: ['Shift'] });
  await detailsPanel(page).getByRole('button', { name: 'Delete 2 selected people' }).click();
  await confirmDelete(page, 'Delete 2 people?');
  await expectCounts(page, 1, 0);
  await expect(personCard(page, 'Joseph Kennedy')).toHaveCount(0);
  await expect(personCard(page, 'Eunice Kennedy')).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expectCounts(page, 3, 2);
  await expectRestoredAfterReload(page, 'My family tree');
});

// Workspace deletion has no undo: the dialog asks for confirmation instead.
test('deleting a tree from Workspace needs confirmation and sticks', async ({ page }) => {
  await buildFamily(page);
  await renameTree(page, 'My family tree', 'Kennedy family');
  await backToWorkspace(page);
  const card = page.getByRole('button', { name: 'Open Kennedy family', exact: true });
  const remove = page.getByRole('button', { name: 'Delete Kennedy family', exact: true });

  await remove.click();
  const dialog = page.getByRole('dialog', { name: 'Delete tree?' });
  await expect(dialog).toContainText('Keep a backup first');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toBeVisible();

  await remove.click();
  await confirmDelete(page, 'Delete tree?');
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start a family tree' })).toBeVisible();
  await expect(card).toHaveCount(0);
});
