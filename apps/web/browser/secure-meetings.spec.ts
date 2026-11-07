import { test, expect, type Page } from '@playwright/test';
import { totp } from '../../../scripts/totp.js';
test.skip(
  !process.env['TEST_MEETING_SECRETARY_PHONE'],
  'Disposable meeting fixtures required',
);
async function login(page: Page, label: string, org: string) {
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
  await expect(
    page.getByLabel('Choose a savings group', { exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel('Choose a savings group', { exact: true })
    .selectOption(org);
}
async function meetings(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 760)
    await page
      .getByRole('button', { name: 'Open navigation', exact: true })
      .click();
  await page.getByRole('button', { name: 'Meetings', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Meeting records', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Refresh meetings', exact: true }),
  ).toBeEnabled();
}
test('secretary records attendance and two independently signed-in officers lock the counted cash', async ({
  page,
  browser,
  context,
}, info) => {
  test.setTimeout(120000);
  const env = process.env;
  const org = env[`TEST_MEETING_ORG_${info.project.name.toUpperCase()}`]!;
  await context.addInitScript(
    ({ org }) =>
      localStorage.setItem(`yapesa-device-${org}`, crypto.randomUUID()),
    { org },
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, 'MEETING_SECRETARY', org);
  await meetings(page);
  let interrupted = false;
  await page.route('**/api/groups/*/meetings', async (route) => {
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
  await page.getByRole('button', { name: 'Open meeting', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: 'Retry this meeting action',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel('New meeting date', { exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Retry this meeting action', exact: true })
    .click();
  await expect(page.locator('.attendance-row')).toHaveCount(2);
  await page
    .locator('.attendance-row')
    .filter({ hasText: 'Local MEETING_SECRETARY' })
    .getByRole('combobox')
    .selectOption('present');
  await expect(
    page.locator('.attendance-row').getByRole('combobox').first(),
  ).toBeEnabled();
  await page
    .locator('.attendance-row')
    .filter({ hasText: 'Local MEETING_MEMBER' })
    .getByRole('combobox')
    .selectOption('excused');
  await expect(
    page
      .locator('.attendance-row')
      .filter({ hasText: 'Local MEETING_MEMBER' })
      .getByRole('combobox'),
  ).toHaveValue('excused');
  await expect(
    page.locator('.attendance-row').getByRole('combobox').first(),
  ).toBeEnabled();
  await page.getByLabel('Counted closing cash', { exact: true }).fill('1');
  await page
    .getByRole('button', { name: 'Prepare closing', exact: true })
    .click();
  expect(
    await page
      .getByLabel('Explanation of cash difference', { exact: true })
      .evaluate(
        (element) => (element as HTMLTextAreaElement).validity.valueMissing,
      ),
  ).toBe(true);
  await expect(
    page.getByRole('region', {
      name: 'Closing record for approval',
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByLabel('Explanation of cash difference', { exact: true })
    .fill('One unit surplus found in the cash box');
  await page
    .getByRole('button', { name: 'Prepare closing', exact: true })
    .click();
  const proposal = page.getByRole('region', {
    name: 'Closing record for approval',
    exact: true,
  });
  await expect(proposal).toContainText('UGX 1');
  await expect(proposal).toContainText('Active officer approvals: 0 / 2');
  await page
    .getByRole('button', { name: 'Approve closing', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'You already approved', exact: true }),
  ).toBeDisabled();
  await expect(proposal).toContainText('Active officer approvals: 1 / 2');
  const officerContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:5173',
    viewport: page.viewportSize() ?? { width: 1440, height: 1100 },
  });
  try {
    const treasurer = await officerContext.newPage();
    await login(treasurer, 'MEETING_TREASURER', org);
    await meetings(treasurer);
    await expect(
      treasurer.getByRole('button', { name: 'Prepare closing', exact: true }),
    ).toHaveCount(0);
    await treasurer
      .getByRole('button', { name: 'Approve closing', exact: true })
      .click();
    await expect(
      treasurer.getByText('Meeting closed and locked.', { exact: true }),
    ).toBeVisible();
    await expect(
      treasurer.getByRole('region', {
        name: 'Closing record for approval',
        exact: true,
      }),
    ).toContainText('Active officer approvals: 2 / 2');
  } finally {
    await officerContext.close();
  }
  await page
    .getByRole('button', { name: 'Refresh meetings', exact: true })
    .click();
  await expect(
    page.getByText('Meeting closed and locked.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.attendance-row').getByRole('combobox'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Prepare closing', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByLabel('Choose a savings group', { exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel('Choose a savings group', { exact: true })
    .selectOption(org);
  await meetings(page);
  await expect(
    page.getByText('Meeting closed and locked.', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('verified-meeting-close.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
