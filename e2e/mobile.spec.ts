import { expect, test, type Page } from '@playwright/test';
import {
  addFirstPerson,
  detailsPanel,
  expectSaved,
  personCard,
  selectPerson,
  startTree,
} from './fixtures';

const expectNoHorizontalScroll = async (page: Page) =>
  expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);

test('the details panel opens, edits and closes without blocking the canvas', async ({ page }) => {
  await startTree(page);
  await expectNoHorizontalScroll(page);
  await addFirstPerson(page, { firstName: 'Grace', lastName: 'Hopper' });
  const panel = detailsPanel(page);
  await panel.getByLabel('Notes').fill('Rear admiral and computer scientist.');
  await expectSaved(page);
  await expectNoHorizontalScroll(page);

  await panel.getByRole('button', { name: 'Close details' }).click();
  await expect(panel).toBeHidden();
  await expectNoHorizontalScroll(page);

  // Clicks fail if anything still covers the card, so this proves the canvas is reachable.
  await selectPerson(page, 'Grace Hopper');
  await expect(panel.getByLabel('Notes')).toHaveValue('Rear admiral and computer scientist.');
  await panel.getByRole('button', { name: 'Close details' }).click();
  await expect(panel).toBeHidden();

  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  await expect(panel.getByLabel('First name')).toHaveValue('');
  await expect(personCard(page, 'Grace Hopper')).toBeVisible();
  await expectNoHorizontalScroll(page);
});
