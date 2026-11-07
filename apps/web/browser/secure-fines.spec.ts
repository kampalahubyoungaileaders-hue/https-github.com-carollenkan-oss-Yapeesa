import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { totp } from '../../../scripts/totp.js';
test.skip(
  !process.env['TEST_MEETING_ADMIN_PHONE'],
  'Disposable fine fixtures required',
);
async function login(page: Page, label: string, org: string) {
  page.setDefaultTimeout(15000);
  const env = process.env;
  await page.goto('/#live');
  await page
    .getByLabel('Phone number', { exact: true })
    .fill(env[`TEST_${label}_PHONE`]!);
  await page.getByLabel('6-digit PIN', { exact: true }).fill(env['TEST_PIN']!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Verify your sign-in', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(totp(env[`TEST_${label}_TOTP`]!));
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  const picker = page.getByLabel('Choose a savings group', { exact: true });
  await expect(picker).toBeEnabled();
  await picker.selectOption(org);
  await expect(picker).toHaveValue(org);
}
async function nav(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1440) < 760)
    await page
      .getByRole('button', { name: 'Open navigation', exact: true })
      .click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function ready(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Refresh fines', exact: true }),
  ).toBeEnabled();
}
test('configured fines remain unpaid until cash receipt, safe retry, waiver and verified close', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  const env = process.env;
  const org = env[`TEST_MEETING_ORG_FINES_${info.project.name.toUpperCase()}`]!;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'MEETING_ADMIN', org);
  await nav(page, 'Fines');
  await ready(page);
  await page.locator('.fine-settings > summary').click();
  for (const r of [
    {
      code: 'late',
      name: 'Late arrival',
      amount: '1000',
      trigger: 'manual',
      partial: 'true',
    },
    {
      code: 'absence',
      name: 'Unexcused absence',
      amount: '500',
      trigger: 'absence',
      partial: 'false',
    },
  ]) {
    await page
      .getByRole('button', { name: 'Add fine type', exact: true })
      .click();
    const row = page.locator('.fine-rule').last();
    await row.getByLabel('Fine code', { exact: true }).fill(r.code);
    await row.getByLabel('Fine name', { exact: true }).fill(r.name);
    await row
      .getByLabel('Fine amount, in whole minor units', { exact: true })
      .fill(r.amount);
    await row
      .getByLabel('When to apply', { exact: true })
      .selectOption(r.trigger);
    await row
      .getByLabel('Allow partial payments?', { exact: true })
      .selectOption(r.partial);
  }
  await page
    .getByRole('button', { name: 'Save fine settings', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Fine record saved.');
  await ready(page);
  const contexts: BrowserContext[] = [];
  try {
    const ctx = await browser.newContext({
      baseURL: 'http://127.0.0.1:5173',
      viewport: page.viewportSize() ?? { width: 1440, height: 1100 },
    });
    contexts.push(ctx);
    const sec = await ctx.newPage();
    sec.on('pageerror', (e) => errors.push(e.message));
    await login(sec, 'MEETING_SECRETARY', org);
    await nav(sec, 'Meetings');
    await expect(
      sec.getByRole('button', { name: 'Refresh meetings', exact: true }),
    ).toBeEnabled();
    await sec
      .getByRole('button', { name: 'Open meeting', exact: true })
      .click();
    await expect(sec.locator('.attendance-row')).toHaveCount(2);
    for (const [name, status] of [
      ['Local MEETING_SECRETARY', 'present'],
      ['Local MEETING_MEMBER', 'absent'],
    ]) {
      await sec
        .locator('.attendance-row')
        .filter({ hasText: name })
        .getByRole('combobox')
        .selectOption(status!);
      await expect(
        sec.locator('.attendance-row').getByRole('combobox').first(),
      ).toBeEnabled();
    }
    await nav(sec, 'Fines');
    await ready(sec);
    await expect(sec.locator('.fine-balances')).toContainText('UGX 500');
    await expect(
      sec.getByRole('button', { name: 'Save fine settings', exact: true }),
    ).toHaveCount(0);
    await expect(
      sec.getByRole('button', { name: 'Download PDF statement', exact: true }),
    ).toHaveCount(0);
    await sec
      .getByLabel('Member to fine', { exact: true })
      .selectOption(env['TEST_MEETING_SECRETARY_PERSON']!);
    await sec.getByLabel('Fine type', { exact: true }).selectOption('late');
    await sec
      .getByLabel('Reason for this record', { exact: true })
      .fill('Arrived after the meeting started');
    await sec
      .getByRole('button', { name: 'Save unpaid fine', exact: true })
      .click();
    await ready(sec);
    const late = sec.locator('.social-record').filter({
      has: sec.getByRole('heading', {
        name: 'Local MEETING_SECRETARY · Late arrival',
        exact: true,
      }),
    });
    await expect(late).toContainText('Unpaid: UGX 1,000');
    let interrupted = false;
    await sec.route('**/api/groups/*/fines', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      if (!interrupted) {
        interrupted = true;
        await route.abort('failed');
      } else await route.fulfill({ response });
    });
    await late
      .getByRole('button', { name: 'Record fine payment', exact: true })
      .click();
    const action = sec.locator('.fine-action');
    await action
      .getByLabel('Cash received, in whole minor units', { exact: true })
      .fill('400');
    await action
      .getByLabel('Reason for this record', { exact: true })
      .fill('Cash received at this meeting');
    await action
      .getByRole('button', { name: 'Save fine record', exact: true })
      .click();
    await expect(
      sec.getByRole('button', { name: 'Retry same fine request', exact: true }),
    ).toBeVisible();
    await sec
      .getByRole('button', { name: 'Retry same fine request', exact: true })
      .click();
    await ready(sec);
    await expect(late).toContainText('Unpaid: UGX 600');
    await expect(sec.locator('.fine-balances')).toContainText('UGX 400');
    await late
      .getByRole('button', { name: 'Waive unpaid amount', exact: true })
      .click();
    await action
      .getByLabel('Reason for this record', { exact: true })
      .fill('Group waived the remaining amount');
    await action
      .getByRole('button', { name: 'Save fine record', exact: true })
      .click();
    await ready(sec);
    await expect(late).toContainText('Waived: UGX 600');
    const payment = (await sec.request.get(`/api/groups/${org}/fines`)).json();
    const saved = await payment;
    expect(
      saved.events.filter((e: { kind: string }) => e.kind === 'payment'),
    ).toHaveLength(1);
    expect(
      saved.charges.filter((r: { due: string }) => r.due === '500'),
    ).toHaveLength(1);
    const downloaded = sec.waitForEvent('download');
    await sec
      .getByRole('button', { name: 'Export member fines CSV', exact: true })
      .click();
    const file = await downloaded;
    await file.saveAs(info.outputPath('member-fines.csv'));
    await nav(sec, 'Meetings');
    await expect(
      sec.getByRole('button', { name: 'Refresh meetings', exact: true }),
    ).toBeEnabled();
    await sec.getByLabel('Counted closing cash', { exact: true }).fill('400');
    await sec
      .getByRole('button', { name: 'Prepare closing', exact: true })
      .click();
    await expect(
      sec.getByRole('button', { name: 'Approve closing', exact: true }),
    ).toBeEnabled();
    await sec
      .getByRole('button', { name: 'Approve closing', exact: true })
      .click();
    await expect(
      sec.getByRole('button', { name: 'You already approved', exact: true }),
    ).toBeDisabled();
    const treasuryCtx = await browser.newContext({
      baseURL: 'http://127.0.0.1:5173',
      viewport: page.viewportSize() ?? { width: 1440, height: 1100 },
    });
    contexts.push(treasuryCtx);
    const treasurer = await treasuryCtx.newPage();
    await login(treasurer, 'MEETING_TREASURER', org);
    await nav(treasurer, 'Meetings');
    await expect(
      treasurer.getByRole('button', { name: 'Refresh meetings', exact: true }),
    ).toBeEnabled();
    await treasurer
      .getByRole('button', { name: 'Approve closing', exact: true })
      .click();
    await expect(
      treasurer.getByText('Meeting closed and locked.', { exact: true }),
    ).toBeVisible();
    await nav(sec, 'Fines');
    await ready(sec);
    await expect(
      sec.getByRole('button', { name: 'Save unpaid fine', exact: true }),
    ).toHaveCount(0);
    await expect(sec.locator('.fine-balances')).toContainText('UGX 500');
    await expect(sec.locator('.fine-balances')).toContainText('UGX 400');
    expect(
      await sec.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await sec.screenshot({
      path: info.outputPath('fines-verified.png'),
      fullPage: true,
      animations: 'disabled',
    });
  } finally {
    for (const ctx of contexts) await ctx.close();
  }
  expect(errors).toEqual([]);
});
