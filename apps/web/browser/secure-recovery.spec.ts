import { test, expect } from '@playwright/test';
import { totp } from '../../../scripts/totp.js';
test.skip(
  !process.env['TEST_REC_MEMBER_PHONE'],
  'Disposable local recovery fixtures only',
);
test('recover PIN explicitly by SMS, retain staff authenticator and sign in again', async ({
  page,
}, info) => {
  const env = process.env;
  const staff = info.project.name === 'phone';
  const label = staff ? 'REC_STAFF' : 'REC_MEMBER';
  const phone = env[`TEST_${label}_PHONE`]!;
  let sends = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/recovery/code')) sends++;
  });
  await page.goto('/#live');
  await page
    .getByRole('button', { name: 'Forgot your PIN?', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Recover your PIN', exact: true }),
  ).toBeVisible();
  expect(sends).toBe(0);
  await page.getByLabel('Phone number', { exact: true }).fill(phone);
  await page
    .getByRole('button', { name: 'Request an SMS code', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'If this phone has an eligible account',
  );
  expect(sends).toBe(1);
  await page
    .getByLabel('SMS verification code', { exact: true })
    .fill(env['TEST_RECOVERY_CODE']!);
  await page
    .getByRole('button', { name: 'Verify SMS code', exact: true })
    .click();
  if (staff) {
    await expect(
      page.getByLabel('Choose a 6-digit PIN', { exact: true }),
    ).toHaveCount(0);
    await page
      .getByLabel('Authenticator code', { exact: true })
      .fill(totp(env['TEST_REC_STAFF_TOTP']!));
    await page
      .getByRole('button', { name: 'Verify code', exact: true })
      .click();
  }
  await page.getByLabel('Choose a 6-digit PIN', { exact: true }).fill('912864');
  await page.getByLabel('Confirm your PIN', { exact: true }).fill('912865');
  await page.getByRole('button', { name: 'Set new PIN', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Confirm your PIN', { exact: true }).fill('912864');
  await page.getByRole('button', { name: 'Set new PIN', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your PIN is updated.');
  expect(sends).toBe(1);
  await page
    .getByRole('button', { name: 'Back to sign in', exact: true })
    .click();
  await page.getByLabel('Phone number', { exact: true }).fill(phone);
  await page.getByLabel('6-digit PIN', { exact: true }).fill('912864');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (staff) {
    await expect(
      page.getByRole('heading', { name: 'Verify your sign-in', exact: true }),
    ).toBeVisible();
    await page
      .getByLabel('Authenticator code', { exact: true })
      .fill(totp(env['TEST_REC_STAFF_TOTP']!));
    await page
      .getByRole('button', { name: 'Verify code', exact: true })
      .click();
  }
  await expect(page.locator('.sidebar-workspace strong')).toHaveText(
    `Local ${label}`,
  );
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
  await page.screenshot({
    path: info.outputPath('recovered-sign-in.png'),
    fullPage: true,
  });
});
