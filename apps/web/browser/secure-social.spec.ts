import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { totp } from '../../../scripts/totp.js';
test.skip(
  !process.env['TEST_MEETING_ADMIN_PHONE'],
  'Disposable social fixtures required',
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
    page.getByRole('button', { name: 'Refresh social records', exact: true }),
  ).toBeEnabled();
}
test('configure a social rule, record equal contributions and approve a grant without changing shares', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  const env = process.env;
  const org =
    env[`TEST_MEETING_ORG_SOCIAL_${info.project.name.toUpperCase()}`]!;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, 'MEETING_ADMIN', org);
  await nav(page, 'Social fund');
  await ready(page);
  await page
    .getByLabel('Contribution per member, in whole minor units', {
      exact: true,
    })
    .fill('1000');
  await page.getByRole('checkbox', { name: 'Treasurer', exact: true }).check();
  await page
    .getByLabel('May the requesting officer approve?', { exact: true })
    .selectOption('true');
  await page
    .getByLabel('Contribution requirement at closing', { exact: true })
    .selectOption('true');
  await page
    .getByRole('button', { name: 'Save social settings', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Social record saved.');
  await ready(page);
  const contexts: BrowserContext[] = [];
  try {
    const secretaryContext = await browser.newContext({
      baseURL: 'http://127.0.0.1:5173',
      viewport: page.viewportSize() ?? { width: 1440, height: 1100 },
    });
    contexts.push(secretaryContext);
    const secretary = await secretaryContext.newPage();
    secretary.on('pageerror', (error) => errors.push(error.message));
    await login(secretary, 'MEETING_SECRETARY', org);
    await nav(secretary, 'Meetings');
    await expect(
      secretary.getByRole('button', { name: 'Refresh meetings', exact: true }),
    ).toBeEnabled();
    await secretary
      .getByRole('button', { name: 'Open meeting', exact: true })
      .click();
    await expect(secretary.locator('.attendance-row')).toHaveCount(2);
    await secretary
      .locator('.attendance-row')
      .filter({ hasText: 'Local MEETING_SECRETARY' })
      .getByRole('combobox')
      .selectOption('present');
    await expect(
      secretary.locator('.attendance-row').getByRole('combobox').first(),
    ).toBeEnabled();
    await secretary
      .locator('.attendance-row')
      .filter({ hasText: 'Local MEETING_MEMBER' })
      .getByRole('combobox')
      .selectOption('present');
    await expect(
      secretary.locator('.attendance-row').getByRole('combobox').first(),
    ).toBeEnabled();
    await nav(secretary, 'Social fund');
    await ready(secretary);
    await expect(
      secretary.getByRole('button', {
        name: 'Save social settings',
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      secretary.getByRole('button', {
        name: 'Download PDF statement',
        exact: true,
      }),
    ).toHaveCount(0);
    let interrupted = false;
    await secretary.route('**/api/groups/*/social', async (route) => {
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
    await secretary
      .getByLabel('Contributing member', { exact: true })
      .selectOption(env['TEST_MEETING_SECRETARY_PERSON']!);
    await secretary
      .getByRole('button', { name: 'Record social contribution', exact: true })
      .click();
    await expect(
      secretary.getByRole('button', {
        name: 'Retry this social action',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      secretary.getByLabel('Contributing member', { exact: true }),
    ).toBeDisabled();
    await secretary
      .getByRole('button', { name: 'Retry this social action', exact: true })
      .click();
    await expect(secretary.locator('.social-balance')).toContainText(
      'UGX 1,000',
    );
    await ready(secretary);
    await secretary
      .getByLabel('Contributing member', { exact: true })
      .selectOption(env['TEST_MEETING_MEMBER_PERSON']!);
    await secretary
      .getByRole('button', { name: 'Record social contribution', exact: true })
      .click();
    await expect(secretary.locator('.social-balance')).toContainText(
      'UGX 2,000',
    );
    await ready(secretary);
    await expect(secretary.locator('.social-entry')).toHaveCount(2);
    const adminWorkspace = await page.request.get('/api/admin/workspace');
    expect(adminWorkspace.status()).toBe(200);
    const administrative = await adminWorkspace.json();
    expect(
      administrative.groups.find((row: { id: string }) => row.id === org)
        .configuration_locked,
    ).toBe(true);
    await secretary
      .getByLabel('Grant recipient', { exact: true })
      .selectOption(env['TEST_MEETING_MEMBER_PERSON']!);
    await secretary
      .getByLabel('Grant amount, in whole minor units', { exact: true })
      .fill('500');
    await secretary
      .getByLabel('Reason for grant', { exact: true })
      .fill('Member welfare grant');
    await secretary
      .getByRole('button', { name: 'Request social grant', exact: true })
      .click();
    await expect(secretary.locator('.social-request')).toContainText(
      'Pending approval',
    );
    await ready(secretary);
    await expect(
      secretary.getByRole('button', {
        name: 'Approve and record cash change',
        exact: true,
      }),
    ).toHaveCount(0);
    const treasurerContext = await browser.newContext({
      baseURL: 'http://127.0.0.1:5173',
      viewport: page.viewportSize() ?? { width: 1440, height: 1100 },
    });
    contexts.push(treasurerContext);
    const treasurer = await treasurerContext.newPage();
    await login(treasurer, 'MEETING_TREASURER', org);
    await nav(treasurer, 'Social fund');
    await ready(treasurer);
    await treasurer
      .getByRole('button', {
        name: 'Approve and record cash change',
        exact: true,
      })
      .click();
    await expect(treasurer.locator('.social-balance')).toContainText(
      'UGX 1,500',
    );
    await ready(treasurer);
    await secretary
      .getByRole('button', { name: 'Refresh social records', exact: true })
      .click();
    await expect(secretary.locator('.social-balance')).toContainText(
      'UGX 1,500',
    );
    await ready(secretary);
    await expect(secretary.locator('.social-entry')).toHaveCount(3);
    await expect(
      secretary.locator('.live-stats .stat-value').nth(1),
    ).toHaveText('0');
    const downloaded = secretary.waitForEvent('download');
    await secretary
      .getByRole('button', { name: 'Export social records CSV', exact: true })
      .click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe(`yapesa-social-${org}.csv`);
    await file.saveAs(info.outputPath('social-fund.csv'));
    await nav(secretary, 'Meetings');
    await expect(
      secretary.getByRole('button', { name: 'Refresh meetings', exact: true }),
    ).toBeEnabled();
    await secretary
      .getByLabel('Counted closing cash', { exact: true })
      .fill('1500');
    await secretary
      .getByRole('button', { name: 'Prepare closing', exact: true })
      .click();
    await expect(
      secretary.getByRole('region', {
        name: 'Closing record for approval',
        exact: true,
      }),
    ).toContainText('UGX 1,500');
    await secretary
      .getByRole('button', { name: 'Approve closing', exact: true })
      .click();
    await expect(
      secretary.getByRole('button', {
        name: 'You already approved',
        exact: true,
      }),
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
    await secretary.reload();
    const picker = secretary.getByLabel('Choose a savings group', {
      exact: true,
    });
    await expect(picker).toBeEnabled();
    await picker.selectOption(org);
    await expect(picker).toHaveValue(org);
    await nav(secretary, 'Social fund');
    await ready(secretary);
    await expect(secretary.locator('.social-balance')).toContainText(
      'UGX 1,500',
    );
    await expect(
      secretary.getByRole('button', {
        name: 'Record social contribution',
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      await secretary.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await secretary.screenshot({
      path: info.outputPath('social-fund-verified.png'),
      fullPage: true,
      animations: 'disabled',
    });
  } finally {
    for (const context of contexts) await context.close();
  }
  expect(errors).toEqual([]);
});
