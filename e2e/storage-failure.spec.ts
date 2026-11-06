import { expect, test, type Page } from '@playwright/test';
import {
  addFirstPerson,
  detailsPanel,
  downloadedBytes,
  downloadFrom,
  expectSaved,
  openTree,
  selectPerson,
  startTree,
} from './fixtures';

declare global {
  interface Window {
    __storageFull?: boolean;
  }
}

const saveFailed = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Local save failed · export JSON' });

test('an unavailable database is reported and edits stay exportable', async ({ page }) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('Browser storage is disabled.', 'InvalidStateError');
    };
  });
  await page.goto('/');
  await expect(
    page.getByRole('alert').filter({ hasText: 'could not be loaded from this browser' }),
  ).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Browser storage is disabled.' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'New tree' }).click();
  await addFirstPerson(page, { firstName: 'Alan', lastName: 'Turing' });
  await expect(saveFailed(page)).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Browser storage is disabled.' }),
  ).toBeVisible();

  // The edit is still in memory, and the suggested JSON export rescues it.
  const backup = JSON.parse(
    (await downloadedBytes(await downloadFrom(page, 'Export JSON'))).toString('utf8'),
  );
  expect(backup.people.map((person: { name: string }) => person.name)).toEqual(['Alan Turing']);
});

test('a full disk is reported, and the next save after space frees up keeps every edit', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (window.__storageFull)
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await startTree(page);
  await page.evaluate(() => (window.__storageFull = true));

  await addFirstPerson(page, { firstName: 'Katherine', lastName: 'Johnson' });
  await expect(saveFailed(page)).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'The quota has been exceeded.' }),
  ).toBeVisible();
  const panel = detailsPanel(page);
  await panel.getByLabel('Nickname').fill('Human computer');
  await expect(saveFailed(page)).toBeVisible();

  await page.evaluate(() => (window.__storageFull = false));
  await panel.getByLabel('Notes').fill('Calculated trajectories for Apollo 11.');
  await expectSaved(page);
  await expect(page.getByRole('alert').filter({ hasText: 'quota' })).toHaveCount(0);

  await page.reload();
  await openTree(page, 'My family tree');
  await selectPerson(page, 'Katherine Johnson');
  await expect(panel.getByLabel('Nickname')).toHaveValue('Human computer');
  await expect(panel.getByLabel('Notes')).toHaveValue('Calculated trajectories for Apollo 11.');
});
