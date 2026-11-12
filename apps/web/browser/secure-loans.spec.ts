import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { totp } from '../../../scripts/totp.js';
test.skip(
  !process.env['TEST_MEETING_ADMIN_PHONE'],
  'Disposable loan fixtures required',
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
    page.getByRole('button', { name: 'Refresh loans', exact: true }),
  ).toBeEnabled();
}
test('review scheduled loan terms, approve as another officer, record cash once, repay and close', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150000);
  const env = process.env,
    org = env[`TEST_MEETING_ORG_LOANS_${info.project.name.toUpperCase()}`]!;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'MEETING_ADMIN', org);
  await nav(page, 'Loans');
  await ready(page);
  await page.locator('.loan-settings > summary').click();
  await page
    .getByLabel('Monthly interest rate (%)', { exact: true })
    .fill('2.50');
  await page
    .getByLabel(
      'Total outstanding principal limit, as a multiple of member shares',
      { exact: true },
    )
    .fill('3');
  await page.getByLabel('Maximum term in months', { exact: true }).fill('3');
  for (const [name, value] of [
    ['Interest method', 'declining'],
    ['Total interest rounding', 'half_up'],
    ['Payment order within each instalment', 'interest_first'],
    ['Monthly due dates', 'original_day'],
    ['Must approvers be different from the recorder and borrower?', 'true'],
    ['Number of different officer approvals required', '1'],
  ])
    await page.getByLabel(name!, { exact: true }).selectOption(value!);
  await page.getByRole('checkbox', { name: 'Treasurer', exact: true }).check();
  await page
    .getByRole('button', { name: 'Save loan settings', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Loan settings saved.');
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
    const meetingDate = await sec.locator('#new-meeting-date').inputValue();
    await sec
      .getByRole('button', { name: 'Open meeting', exact: true })
      .click();
    await expect(sec.locator('.attendance-row')).toHaveCount(2);
    for (const name of ['Local MEETING_SECRETARY', 'Local MEETING_MEMBER']) {
      await sec
        .locator('.attendance-row')
        .filter({ hasText: name })
        .getByRole('combobox')
        .selectOption('present');
      await expect(
        sec.locator('.attendance-row').getByRole('combobox').first(),
      ).toBeEnabled();
    }
    await nav(sec, 'Overview');
    await sec.locator('#saved-date').fill(meetingDate);
    await sec
      .getByLabel('Member', { exact: true })
      .selectOption(env['TEST_MEETING_MEMBER_PERSON']!);
    await sec.getByLabel('Number of shares', { exact: true }).fill('5');
    await sec
      .getByRole('button', { name: 'Save to group', exact: true })
      .click();
    await expect(sec.getByRole('status')).toContainText(
      'Share purchase saved.',
    );
    await nav(sec, 'Loans');
    await ready(sec);
    await expect(
      sec.getByRole('button', { name: 'Save loan settings', exact: true }),
    ).toHaveCount(0);
    await expect(
      sec.getByRole('button', { name: 'Download PDF statement', exact: true }),
    ).toHaveCount(0);
    await sec
      .getByLabel('Borrower', { exact: true })
      .selectOption(env['TEST_MEETING_MEMBER_PERSON']!);
    await sec
      .getByLabel('Principal, in whole minor units', { exact: true })
      .fill('20000');
    await sec.getByLabel('Term in months', { exact: true }).fill('3');
    await sec
      .getByLabel('Reason for this loan record', { exact: true })
      .fill('Market stock purchase');
    await sec
      .getByRole('button', { name: 'Review loan cost', exact: true })
      .click();
    await expect(sec.locator('.loan-quote')).toContainText('UGX 1,000');
    await sec
      .getByRole('button', { name: 'Save loan request', exact: true })
      .click();
    await ready(sec);
    await expect(sec.locator('.loan-request')).toHaveCount(1);
    await expect(
      sec.getByRole('button', {
        name: 'Review cash disbursement',
        exact: true,
      }),
    ).toBeDisabled();
    const tc = await browser.newContext({
      baseURL: 'http://127.0.0.1:5173',
      viewport: page.viewportSize() ?? { width: 1440, height: 1100 },
    });
    contexts.push(tc);
    const treasurer = await tc.newPage();
    await login(treasurer, 'MEETING_TREASURER', org);
    await nav(treasurer, 'Loans');
    await ready(treasurer);
    await treasurer
      .getByRole('button', { name: 'Approve loan terms', exact: true })
      .click();
    await ready(treasurer);
    await expect(treasurer.locator('.loan-request')).toContainText('1/1');
    await sec
      .getByRole('button', { name: 'Refresh loans', exact: true })
      .click();
    await ready(sec);
    await sec
      .getByRole('button', { name: 'Review cash disbursement', exact: true })
      .click();
    let interrupted = false;
    await sec.route('**/api/groups/*/loans', async (route) => {
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
    const action = sec.locator('.loan-action');
    await action
      .getByLabel('Reason for this loan record', { exact: true })
      .fill('Cash handed to the borrower');
    await action
      .getByRole('checkbox', {
        name: 'I confirm this cash was handed over',
        exact: true,
      })
      .check();
    await action
      .getByRole('button', {
        name: 'Record loan cash handed over',
        exact: true,
      })
      .click();
    await expect(
      sec.getByRole('button', { name: 'Retry same loan request', exact: true }),
    ).toBeVisible();
    await sec
      .getByRole('button', { name: 'Retry same loan request', exact: true })
      .click();
    await ready(sec);
    await expect(sec.locator('.loan-book-entry')).toHaveCount(1);
    await expect(sec.locator('.loan-book-entry')).toContainText('UGX 20,000');
    await expect(sec.locator('.social-balance')).toContainText('UGX 5,000');
    async function repay(amount: string) {
      await sec
        .locator('.loan-book-entry')
        .getByRole('button', { name: 'Record loan repayment', exact: true })
        .click();
      await action
        .getByLabel('Cash received, in whole minor units', { exact: true })
        .fill(amount);
      await action
        .getByLabel('Reason for this loan record', { exact: true })
        .fill('Borrower cash repayment');
      await action
        .getByRole('checkbox', {
          name: 'I confirm this cash was received',
          exact: true,
        })
        .check();
      await action
        .getByRole('button', { name: 'Save loan repayment', exact: true })
        .click();
      await ready(sec);
    }
    await repay('100');
    await expect(sec.locator('.loan-book-entry')).toContainText('UGX 900');
    const receipt = sec.locator('.loan-event').filter({
      has: sec.getByRole('heading', {
        name: 'Local MEETING_MEMBER · Repayment',
        exact: true,
      }),
    });
    await receipt
      .getByRole('button', { name: 'Reverse loan record', exact: true })
      .click();
    await action
      .getByLabel('Reason for this loan record', { exact: true })
      .fill('Correcting the repayment receipt');
    await action
      .getByRole('checkbox', {
        name: 'I confirm the cash change shown by this correction',
        exact: true,
      })
      .check();
    await action
      .getByRole('button', { name: 'Save exact loan correction', exact: true })
      .click();
    await ready(sec);
    await expect(sec.locator('.loan-book-entry')).toContainText('UGX 1,000');
    await repay('21000');
    await expect(sec.locator('.loan-book-entry')).toContainText('Fully repaid');
    const actual = await (
      await sec.request.get(`/api/groups/${org}/loans`)
    ).json();
    expect(actual.loans).toHaveLength(1);
    expect(
      actual.events.filter((e: { kind: string }) => e.kind === 'disbursement'),
    ).toHaveLength(1);
    const download = sec.waitForEvent('download');
    await sec
      .getByRole('button', {
        name: 'Export loan cash history CSV',
        exact: true,
      })
      .click();
    await (await download).saveAs(info.outputPath('loan-cash-history.csv'));
    await nav(sec, 'Overview');
    await sec
      .getByRole('button', { name: 'Preview share-out', exact: true })
      .click();
    await expect(sec.locator('.shareout-panel')).toContainText('UGX 26,000');
    await nav(sec, 'Meetings');
    await expect(
      sec.getByRole('button', { name: 'Refresh meetings', exact: true }),
    ).toBeEnabled();
    await sec.getByLabel('Counted closing cash', { exact: true }).fill('26000');
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
    await nav(sec, 'Loans');
    await ready(sec);
    await expect(
      sec.getByRole('button', { name: 'Reverse loan record', exact: true }),
    ).toHaveCount(0);
    expect(
      await sec.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await sec.screenshot({
      path: info.outputPath('loans-verified.png'),
      fullPage: true,
      animations: 'disabled',
    });
  } finally {
    for (const ctx of contexts) await ctx.close();
  }
  expect(errors).toEqual([]);
});
