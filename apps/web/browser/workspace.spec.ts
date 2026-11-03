import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function navigate(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1440) < 760)
    await page
      .getByRole('button', { name: 'Open navigation', exact: true })
      .click();
  await page.getByRole('link', { name, exact: true }).click();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
async function purchase(
  page: Page,
  count: string,
  note: string,
  date = '2026-11-03',
) {
  await page
    .getByRole('button', { name: 'Record shares', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Record a share purchase',
    exact: true,
  });
  await dialog.getByLabel('Member', { exact: true }).selectOption('amina');
  await dialog.getByLabel('Meeting date', { exact: true }).fill(date);
  await dialog.getByLabel('Number of shares', { exact: true }).fill(count);
  await dialog.getByLabel('Note (optional)', { exact: true }).fill(note);
  await dialog
    .getByRole('button', { name: 'Save sample record', exact: true })
    .click();
}

test('group workspace, share recording, persistence, reversal, limits and export', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Your workspace', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText(
        'Sample records only. Changes stay in this browser and are not live financial records.',
        { exact: true },
      )
      .last(),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath('dashboard.png'),
    fullPage: true,
  });
  const baseline = await page
    .locator('.stat-card.accent .stat-value')
    .innerText();
  await purchase(page, '3', 'Browser check');
  await expect(page.getByRole('status')).toContainText(
    'Sample share purchase recorded.',
  );
  await navigate(page, 'Ledger');
  await page.getByRole('searchbox').fill('Browser check');
  await expect(page.locator('.record-row')).toHaveCount(1);
  await expect(page.locator('.record-row')).toContainText('UGX 15,000');
  await page.reload();
  await page.getByRole('searchbox').fill('Browser check');
  await expect(page.locator('.record-row')).toHaveCount(1);
  await page.locator('.record-row').click();
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
  await noOverflow(page);
  await page
    .getByRole('button', { name: 'Reverse entry', exact: true })
    .click();
  await page
    .getByLabel('Reason', { exact: true })
    .fill('Browser check correction');
  await page.getByRole('button', { name: 'Add reversal', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    'Reversing entry added.',
  );
  await expect(page.locator('.record-row')).toHaveCount(2);
  await navigate(page, 'Overview');
  await expect(page.locator('.stat-card.accent .stat-value')).toHaveText(
    baseline,
  );
  await page.getByLabel('Choose a savings group').selectOption('nakawa');
  await expect(page.locator('.group-card.selected')).toContainText(
    'Nakawa Community Savers',
  );
  await navigate(page, 'Members');
  await page.getByRole('searchbox').fill('Amina');
  await expect(page.locator('.member-row')).toHaveCount(1);
  await page.locator('.member-row').click();
  await expect(
    page.getByRole('heading', { name: 'Member passbook', exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await navigate(page, 'Meetings');
  await page.locator('.meeting-row').first().click();
  await expect(
    page.getByRole('heading', { name: 'Meeting records', exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.getByLabel('Choose a savings group').selectOption('umoja');
  await purchase(page, '5', 'Limit check', '2026-11-04');
  await expect(page.getByRole('status')).toContainText(
    'Sample share purchase recorded.',
  );
  await purchase(page, '1', 'Too many shares', '2026-11-04');
  await expect(page.getByRole('alert')).toContainText(
    'The total must stay within this group’s meeting limit.',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await navigate(page, 'Ledger');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('yapesa-demo-umoja-ledger.csv');
  const path = await download.path();
  expect(path).not.toBeNull();
  const csv = await readFile(path!, 'utf8');
  expect(csv).toContain('Browser check correction');
  expect(csv).toContain('Limit check');
  expect(csv).not.toContain('Too many shares');
  await noOverflow(page);
  expect(errors).toEqual([]);
});
