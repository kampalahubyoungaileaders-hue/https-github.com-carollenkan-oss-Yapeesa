import { test, expect, type Page } from '@playwright/test';
import { totp } from '../../../scripts/totp.js';
test.skip(
  !process.env['TEST_LOST_DESKTOP_PHONE'],
  'Disposable MFA reset fixtures only',
);
test('two administrators verify identity and the recipient restores access with fresh SMS and a new authenticator', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  const env = process.env,
    label = info.project.name === 'phone' ? 'LOST_PHONE' : 'LOST_DESKTOP',
    phone = env[`TEST_${label}_PHONE`]!,
    name = `Local ${label}`;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#live');
  await page
    .getByRole('button', { name: 'Forgot your PIN?', exact: true })
    .click();
  await page.getByLabel('Phone number', { exact: true }).fill(phone);
  await page
    .getByLabel('SMS verification code', { exact: true })
    .fill(env['TEST_RECOVERY_CODE']!);
  await page
    .getByRole('button', { name: 'Verify SMS code', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'I have lost my authenticator', exact: true })
    .click();
  await page
    .getByLabel('Reason for authenticator recovery', { exact: true })
    .fill('Replaced the device; independent identity checks requested');
  await page
    .getByRole('button', {
      name: 'Save authenticator recovery request',
      exact: true,
    })
    .click();
  await expect(
    page.getByText('Recovery request saved. Reference:', { exact: false }),
  ).toBeVisible();
  const contextA = await browser.newContext({ viewport: page.viewportSize()! }),
    contextB = await browser.newContext({ viewport: page.viewportSize()! });
  async function admin(p: Page, actor: string) {
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto('/#live');
    await p
      .getByLabel('Phone number', { exact: true })
      .fill(env[`TEST_${actor}_PHONE`]!);
    await p.getByLabel('6-digit PIN', { exact: true }).fill(env['TEST_PIN']!);
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await p
      .getByLabel('Authenticator code', { exact: true })
      .fill(totp(env[`TEST_${actor}_TOTP`]!));
    await p.getByRole('button', { name: 'Verify code', exact: true }).click();
    if ((p.viewportSize()?.width ?? 1440) < 760)
      await p
        .getByRole('button', { name: 'Open navigation', exact: true })
        .click();
    await p
      .getByRole('navigation', { name: 'Your workspace', exact: true })
      .getByRole('button', { name: 'Administration', exact: true })
      .click();
    return p
      .getByRole('article')
      .filter({ has: p.getByRole('heading', { name, exact: true }) });
  }
  try {
    const a = await admin(await contextA.newPage(), 'ADMIN');
    await a
      .getByLabel('How did you verify this person’s identity?', { exact: true })
      .fill(
        'Compared original identity record and independently verified the registered phone holder',
      );
    await a
      .getByLabel('I verified this person’s identity independently', {
        exact: true,
      })
      .check();
    await a
      .getByRole('button', {
        name: 'Record my identity verification',
        exact: true,
      })
      .click();
    await expect(
      a.getByText('Eligible independent approvals: 1 / 2', { exact: true }),
    ).toBeVisible();
    await expect(
      a.getByRole('button', {
        name: 'Reset approved authenticator factors',
        exact: true,
      }),
    ).toBeDisabled();
    const b = await admin(await contextB.newPage(), 'MEETING_ADMIN');
    await b
      .getByLabel('How did you verify this person’s identity?', { exact: true })
      .fill(
        'Separate verification against staff identity record and an independent conversation',
      );
    await b
      .getByLabel('I verified this person’s identity independently', {
        exact: true,
      })
      .check();
    await b
      .getByRole('button', {
        name: 'Record my identity verification',
        exact: true,
      })
      .click();
    await expect(
      b.getByText('Eligible independent approvals: 2 / 2', { exact: true }),
    ).toBeVisible();
    await b
      .getByRole('button', {
        name: 'Reset approved authenticator factors',
        exact: true,
      })
      .click();
    await expect(
      b.getByText('Factors reset; awaiting fresh SMS and a new authenticator', {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Return to SMS verification', exact: true })
      .click();
    await page
      .getByLabel('SMS verification code', { exact: true })
      .fill(env['TEST_RECOVERY_CODE']!);
    await page
      .getByRole('button', { name: 'Verify SMS code', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Set up an authenticator', exact: true })
      .click();
    const secret = await page
      .getByLabel('Setup key', { exact: true })
      .inputValue();
    await page
      .getByLabel('Authenticator code', { exact: true })
      .fill(totp(secret));
    await page
      .getByRole('button', { name: 'Verify code', exact: true })
      .click();
    await page
      .getByLabel('Choose a 6-digit PIN', { exact: true })
      .fill('943812');
    await page.getByLabel('Confirm your PIN', { exact: true }).fill('943812');
    await page
      .getByRole('button', { name: 'Set new PIN', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'Your PIN is updated.',
    );
    await page
      .getByRole('button', { name: 'Back to sign in', exact: true })
      .click();
    await page.getByLabel('Phone number', { exact: true }).fill(phone);
    await page.getByLabel('6-digit PIN', { exact: true }).fill('943812');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page
      .getByLabel('Authenticator code', { exact: true })
      .fill(totp(secret));
    await page
      .getByRole('button', { name: 'Verify code', exact: true })
      .click();
    await expect(page.locator('.sidebar-workspace strong')).toHaveText(name);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath('authenticator-recovered.png'),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
