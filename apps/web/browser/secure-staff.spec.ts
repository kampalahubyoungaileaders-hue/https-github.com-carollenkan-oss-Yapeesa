import { test, expect } from '@playwright/test';
import { totp } from '../../../scripts/totp.js';
test.skip(
  !process.env['TEST_ADMIN_PHONE'],
  'Disposable local staff fixtures only',
);
test('administrator prepares one account and the officer activates it only after phone, PIN and authenticator proof', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150000);
  const env = process.env,
    phone = info.project.name === 'phone' ? '+256700000025' : '+256700000024',
    name = `Local invited ${info.project.name}`;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#live');
  await page
    .getByLabel('Phone number', { exact: true })
    .fill(env['TEST_ADMIN_PHONE']!);
  await page.getByLabel('6-digit PIN', { exact: true }).fill(env['TEST_PIN']!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(totp(env['TEST_ADMIN_TOTP']!));
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  if ((page.viewportSize()?.width ?? 1440) < 760)
    await page
      .getByRole('button', { name: 'Open navigation', exact: true })
      .click();
  await page
    .getByRole('navigation', { name: 'Your workspace', exact: true })
    .getByRole('button', { name: 'Administration', exact: true })
    .click();
  const staff = page.getByRole('region', {
    name: 'Staff account setup',
    exact: true,
  });
  await staff
    .getByLabel('Staff group', { exact: true })
    .selectOption(env['TEST_ORG_A']!);
  await staff.getByLabel('Staff full name', { exact: true }).fill(name);
  await staff.getByLabel('Staff phone number', { exact: true }).fill(phone);
  await staff
    .getByLabel('Staff email address', { exact: true })
    .fill(`local-invited-${info.project.name}@example.invalid`);
  await staff
    .getByLabel('Staff role', { exact: true })
    .selectOption('treasurer');
  await staff
    .getByLabel('Reason for access', { exact: true })
    .fill('Local browser staff setup proof');
  const requests: string[] = [];
  let interrupted = false;
  await page.route('**/api/admin/staff/invitations', async (route) => {
    requests.push(route.request().postDataJSON().request_id);
    const response = await route.fetch();
    if (!interrupted) {
      interrupted = true;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await staff
    .getByRole('button', { name: 'Create staff account', exact: true })
    .click();
  await expect(
    staff.getByRole('button', {
      name: 'Retry saved account setup',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    staff.getByLabel('Staff full name', { exact: true }),
  ).toBeDisabled();
  await staff
    .getByRole('button', { name: 'Retry saved account setup', exact: true })
    .click();
  await expect(staff.getByRole('heading', { name, exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toBe(requests[1]);
  await page.screenshot({
    path: info.outputPath('staff-prepared.png'),
    fullPage: true,
  });
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: page.viewportSize()!,
  });
  const officer = await context.newPage();
  officer.on('pageerror', (e) => errors.push(e.message));
  try {
    await officer.goto('/#live');
    await officer
      .getByRole('button', { name: 'First-time account setup', exact: true })
      .click();
    await officer.getByLabel('Phone number', { exact: true }).fill(phone);
    await officer
      .getByLabel('SMS verification code', { exact: true })
      .fill(env['TEST_RECOVERY_CODE']!);
    await officer
      .getByLabel('Choose a 6-digit PIN', { exact: true })
      .fill(env['TEST_PIN']!);
    await officer
      .getByLabel('Confirm your PIN', { exact: true })
      .fill(env['TEST_PIN']!);
    await officer
      .getByRole('button', { name: 'Verify phone and save PIN', exact: true })
      .click();
    await expect(
      officer.getByRole('heading', {
        name: 'Verify your sign-in',
        exact: true,
      }),
    ).toBeVisible();
    await officer
      .getByRole('button', { name: 'Set up an authenticator', exact: true })
      .click();
    const secret = await officer
      .getByLabel('Setup key', { exact: true })
      .inputValue();
    await officer
      .getByLabel('Authenticator code', { exact: true })
      .fill(totp(secret));
    await officer
      .getByRole('button', { name: 'Verify code', exact: true })
      .click();
    await expect(officer.locator('.sidebar-workspace strong')).toHaveText(name);
    expect(
      await officer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await officer.evaluate(() =>
        Object.keys(localStorage).some((key) => /token|pin|session/i.test(key)),
      ),
    ).toBe(false);
    await officer.screenshot({
      path: info.outputPath('staff-activated.png'),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
