import { test, expect } from '@playwright/test';

test('invitation setup requests SMS only on demand and takes the user to MFA', async ({
  page,
}) => {
  let smsRequests = 0;
  let accepts = 0;
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { configured: true, user: null } }),
  );
  await page.route('**/api/auth/invitation/code', (route) => {
    smsRequests++;
    expect(route.request().postDataJSON()).toEqual({ phone: '+256700000011' });
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/auth/invitation/accept', (route) => {
    accepts++;
    expect(route.request().postDataJSON()).toEqual({
      phone: '+256700000011',
      code: '123456',
      pin: '638291',
    });
    return route.fulfill({
      json: {
        configured: true,
        user: {
          person_id: '00000000-0000-4000-8000-000000000011',
          display_name: 'Test invite',
          requires_mfa: true,
          mfa_verified: false,
          factors: [],
        },
      },
    });
  });
  await page.goto('/#live');
  await page.getByRole('button', { name: 'First-time account setup' }).click();
  expect(smsRequests).toBe(0);
  await page.getByLabel('Phone number', { exact: true }).fill('+256700000011');
  await page.getByRole('button', { name: 'Request an SMS code' }).click();
  await expect(page.getByRole('status')).toContainText('Check your phone');
  expect(smsRequests).toBe(1);
  await page.getByLabel('SMS verification code').fill('123456');
  await page.getByLabel('Choose a 6-digit PIN').fill('638291');
  await page.getByLabel('Confirm your PIN').fill('638292');
  await page.getByRole('button', { name: 'Verify phone and save PIN' }).click();
  await expect(page.getByRole('alert')).toHaveText('The PINs do not match.');
  expect(accepts).toBe(0);
  await page.getByLabel('Confirm your PIN').fill('638291');
  await page.getByRole('button', { name: 'Verify phone and save PIN' }).click();
  await expect(
    page.getByRole('button', { name: 'Set up an authenticator' }),
  ).toBeVisible();
  expect(accepts).toBe(1);
  expect(smsRequests).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
