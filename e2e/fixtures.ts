import { readFile } from 'node:fs/promises';
import { expect, type Download, type Page } from '@playwright/test';

export type PersonFields = { firstName: string; lastName?: string };

export const detailsPanel = (page: Page) =>
  page.getByRole('complementary', { name: 'Tree details' });

/** Matches the cards' accessible names, which may append a kinship description. */
export const personCard = (page: Page, name: string) =>
  page.getByRole('button', {
    name: new RegExp(`^Edit ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(,|$)`),
  });

export async function expectSaved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: 'Saved locally' })).toBeVisible();
}

export async function expectCounts(page: Page, people: number, connections: number) {
  await expect(page.getByText(`${people} people · ${connections} connections`)).toBeVisible();
}

/** Opens a new, unsaved tree. Each test gets a fresh browser context, so storage starts empty. */
export async function startTree(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a family tree' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Make a change' })).toBeVisible();
}

export async function nameSelectedPerson(page: Page, { firstName, lastName }: PersonFields) {
  const panel = detailsPanel(page);
  await panel.getByLabel('First name').fill(firstName);
  if (lastName !== undefined) await panel.getByLabel('Last name').fill(lastName);
  const name = [firstName, lastName].filter(Boolean).join(' ');
  await expect(panel.getByRole('heading', { name, exact: true })).toBeVisible();
}

export async function addFirstPerson(page: Page, person: PersonFields) {
  await page.getByRole('button', { name: 'Add first person' }).click();
  await nameSelectedPerson(page, person);
}

/** Adds a relative of the person whose details are open; the new person is then selected. */
export async function addRelative(
  page: Page,
  relative: 'Parent' | 'Child' | 'Partner',
  person: PersonFields,
) {
  const panel = detailsPanel(page);
  const add = panel.getByRole('button', { name: `+ ${relative}` });
  // The Relationships section starts collapsed for each person.
  if (!(await add.isVisible())) await panel.getByRole('heading', { name: 'Relationships' }).click();
  await add.click();
  await expect(panel.getByLabel('First name')).toHaveValue('');
  await nameSelectedPerson(page, person);
}

export async function selectPerson(page: Page, name: string) {
  await personCard(page, name).click();
  await expect(detailsPanel(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

export async function renameTree(page: Page, from: string, to: string) {
  await page.getByRole('button', { name: from, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename tree' });
  await dialog.getByLabel('Tree name').fill(to);
  await dialog.getByRole('button', { name: 'Save name' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: to, exact: true })).toBeVisible();
}

export async function backToWorkspace(page: Page) {
  await page.getByRole('button', { name: 'Back to trees' }).click();
  await expect(page.getByRole('heading', { name: 'Your family trees' })).toBeVisible();
}

export async function openTree(page: Page, name: string) {
  await page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
}

export async function downloadFrom(page: Page, buttonName: string) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  return download;
}

export async function downloadedBytes(download: Download) {
  return readFile(await download.path());
}
