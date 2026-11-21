import { expect, test, type Page } from '@playwright/test';
import {
  addFirstPerson,
  addRelative,
  detailsPanel,
  expectCounts,
  personCard,
  selectPerson as selectPersonCard,
  startTree,
} from './fixtures';

/** New relatives scroll the canvas, so bring every card into view before clicking one. */
async function selectPerson(page: Page, name: string) {
  await page.getByRole('button', { name: 'Fit tree' }).click();
  await selectPersonCard(page, name);
}

/** Bea → Ana (home, partnered with Eve) → Cal → Dee */
async function buildLine(page: Page) {
  await startTree(page);
  await addFirstPerson(page, { firstName: 'Ana' });
  await addRelative(page, 'Parent', { firstName: 'Bea' });
  await selectPerson(page, 'Ana');
  await addRelative(page, 'Partner', { firstName: 'Eve' });
  await selectPerson(page, 'Ana');
  await addRelative(page, 'Child', { firstName: 'Cal' });
  await addRelative(page, 'Child', { firstName: 'Dee' });
  await selectPerson(page, 'Ana');
  await detailsPanel(page).getByRole('button', { name: 'Set as home person' }).click();
  await expectCounts(page, 5, 4);
}
const view = (page: Page) => page.locator('.canvas-view');

test('highlights the path from the home person to the selected person', async ({ page }) => {
  await buildLine(page);
  await selectPerson(page, 'Dee');
  for (const name of ['Ana', 'Cal'])
    await expect(personCard(page, name)).toHaveClass(/on-kinship-path/);
  for (const name of ['Bea', 'Eve'])
    await expect(personCard(page, name)).not.toHaveClass(/on-kinship-path/);
  await expect(page.locator('.react-flow__edge.kinship-path')).toHaveCount(2);
});

test('collapses a branch and expands it from the card', async ({ page }) => {
  await buildLine(page);
  await selectPerson(page, 'Ana');
  await detailsPanel(page).getByRole('button', { name: 'Collapse' }).click();
  await expect(view(page)).toContainText('Collapsed branches · 2 hidden');
  for (const name of ['Cal', 'Dee']) await expect(personCard(page, name)).toBeHidden();
  await expect(personCard(page, 'Eve')).toBeVisible();
  await page.getByRole('button', { name: "Show 2 hidden people in Ana's branch" }).click();
  await expect(view(page)).toBeHidden();
  for (const name of ['Cal', 'Dee']) await expect(personCard(page, name)).toBeVisible();
});

test('focuses on ancestors and shows everyone again', async ({ page }) => {
  await buildLine(page);
  await selectPerson(page, 'Cal');
  const ancestors = detailsPanel(page).getByRole('button', { name: 'Ancestors' });
  await ancestors.click();
  await expect(ancestors).toHaveAttribute('aria-pressed', 'true');
  await expect(view(page)).toContainText('Ancestors of Cal · 2 hidden');
  for (const name of ['Cal', 'Ana', 'Bea']) await expect(personCard(page, name)).toBeVisible();
  for (const name of ['Dee', 'Eve']) await expect(personCard(page, name)).toBeHidden();
  await view(page).getByRole('button', { name: 'Show everyone' }).click();
  await expect(view(page)).toBeHidden();
  for (const name of ['Dee', 'Eve']) await expect(personCard(page, name)).toBeVisible();
});

test('searching for a hidden person shows everyone', async ({ page }) => {
  await buildLine(page);
  await selectPerson(page, 'Cal');
  await detailsPanel(page).getByRole('button', { name: 'Ancestors' }).click();
  await expect(personCard(page, 'Eve')).toBeHidden();
  await page.getByRole('searchbox', { name: 'Search this tree' }).fill('Eve');
  await page
    .getByRole('list', { name: 'Matching people' })
    .getByRole('button', { name: /Eve/ })
    .click();
  await expect(view(page)).toBeHidden();
  await expect(personCard(page, 'Eve')).toBeVisible();
});
