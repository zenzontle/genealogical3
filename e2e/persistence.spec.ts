import { expect, test } from '@playwright/test';
import {
  addFirstPerson,
  addRelative,
  detailsPanel,
  expectCounts,
  expectSaved,
  nameSelectedPerson,
  openTree,
  renameTree,
  selectPerson,
  startTree,
} from './fixtures';

test('edits persist in IndexedDB across a reload', async ({ page }) => {
  await startTree(page);
  await addFirstPerson(page, { firstName: 'Ada', lastName: 'Byron' });
  await addRelative(page, 'Child', { firstName: 'Anne', lastName: 'King' });
  await addRelative(page, 'Partner', { firstName: 'William', lastName: 'Blunt' });

  // Rename someone after the fact, then fill in dates and notes.
  await selectPerson(page, 'Ada Byron');
  await nameSelectedPerson(page, { firstName: 'Ada', lastName: 'Lovelace' });
  const panel = detailsPanel(page);
  await panel.getByLabel('Nickname').fill('Enchantress of Numbers');
  await panel.getByRole('combobox', { name: 'Born', exact: true }).selectOption('full');
  await panel.getByLabel('Born date').fill('1815-12-10');
  await panel.getByRole('combobox', { name: 'Status' }).selectOption('deceased');
  await panel.getByRole('combobox', { name: 'Died', exact: true }).selectOption('year');
  await panel.getByLabel('Died year').fill('1852');
  await panel.getByLabel('Notes').fill('Wrote the first published algorithm.');
  await renameTree(page, 'My family tree', 'Lovelace family');
  await expectCounts(page, 3, 2);
  await expectSaved(page);

  await page.reload();

  const card = page.getByRole('button', { name: 'Open Lovelace family', exact: true });
  await expect(card).toContainText('3 people');
  await expect(card).toContainText('Lovelace family');

  await openTree(page, 'Lovelace family');
  await expectCounts(page, 3, 2);
  await expectSaved(page);
  await selectPerson(page, 'Ada Lovelace');
  await expect(panel.getByLabel('First name')).toHaveValue('Ada');
  await expect(panel.getByLabel('Last name')).toHaveValue('Lovelace');
  await expect(panel.getByLabel('Nickname')).toHaveValue('Enchantress of Numbers');
  await expect(panel.getByLabel('Born date')).toHaveValue('1815-12-10');
  await expect(panel.getByRole('combobox', { name: 'Status' })).toHaveValue('deceased');
  await expect(panel.getByLabel('Died year')).toHaveValue('1852');
  await expect(panel.getByLabel('Notes')).toHaveValue('Wrote the first published algorithm.');
  await selectPerson(page, 'Anne King');
  await selectPerson(page, 'William Blunt');
});
