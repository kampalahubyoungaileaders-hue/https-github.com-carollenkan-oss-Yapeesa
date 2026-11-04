import { test, expect } from '@playwright/test';
import { totp } from '../../../scripts/totp.js';
test.skip(
  !process.env['TEST_A_PHONE'],
  'Requires the disposable local Auth/database fixtures',
);
test('sign in with MFA, save shares, reload and inspect the real journal', async ({
  page,
  context,
}, info) => {
  test.setTimeout(90000);
  const env = process.env;
  const org = env['TEST_ORG_A']!;
  await context.addInitScript(
    ({ org, device }) => {
      localStorage.setItem(`yapesa-device-${org}`, device);
    },
    { org, device: env['TEST_DEVICE_A']! },
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#live');
  await page
    .getByLabel('Phone number', { exact: true })
    .fill(env['TEST_A_PHONE']!);
  await page.getByLabel('6-digit PIN', { exact: true }).fill(env['TEST_PIN']!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Verify your sign-in', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(totp(env['TEST_A_TOTP']!));
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Local group A', level: 1, exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Member', { exact: true })
    .selectOption(env['TEST_A_PERSON']!);
  await page.getByLabel('Number of shares', { exact: true }).fill('1');
  await page
    .getByLabel('Note (optional)', { exact: true })
    .fill(`Saved from ${info.project.name}`);
  let interrupted = false;
  await page.route('**/api/groups/*/shares', async (route) => {
    const response = await route.fetch();
    if (!interrupted) {
      interrupted = true;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await page
    .getByRole('button', { name: 'Save to group', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Retry this save', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Number of shares', { exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Retry this save', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Share purchase saved.');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Local group A', level: 1, exact: true }),
  ).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) < 760)
    await page
      .getByRole('button', { name: 'Open navigation', exact: true })
      .click();
  await page.getByRole('button', { name: 'Ledger', exact: true }).click();
  const totals = await page
    .locator('.live-stats .stat-value')
    .allTextContents();
  await page.getByRole('searchbox').fill(`Saved from ${info.project.name}`);
  await expect(page.locator('.record-row')).toHaveCount(1);
  await expect(page.locator('.live-stats .stat-value')).toHaveText(totals);
  await page.locator('.record-row').click();
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some((key) => /token|pin|session/i.test(key)),
    ),
  ).toBe(false);
  const downloadPromise = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Download PDF statement', exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`yapesa-${org}.pdf`);
  await download.saveAs(info.outputPath('statement.pdf'));
  await page.screenshot({
    path: info.outputPath('saved-workspace.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
