import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { v7 } from 'uuid';
import { totp } from '../../../scripts/totp.js';
test.skip(
  !process.env['TEST_MEETING_ADMIN_PHONE'],
  'Disposable programme fixtures required',
);
async function login(page: Page, label: string, org: string) {
  page.setDefaultTimeout(15000);
  await page.goto('/#live');
  await page
    .getByLabel('Phone number', { exact: true })
    .fill(process.env[`TEST_${label}_PHONE`]!);
  await page
    .getByLabel('6-digit PIN', { exact: true })
    .fill(process.env['TEST_PIN']!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Verify your sign-in', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(totp(process.env[`TEST_${label}_TOTP`]!));
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  if (org) {
    const picker = page.getByLabel('Choose a savings group', { exact: true });
    await expect(picker).toBeEnabled();
    await picker.selectOption(org);
    await expect(picker).toHaveValue(org);
  }
}
async function post(context: BrowserContext, url: string, data: object) {
  const r = await context.request.post(url, {
    data,
    headers: { origin: 'http://127.0.0.1:5173' },
  });
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}

test('administrator links a programme and an officer identifies inactive meetings, reviews trends and loses revoked access', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150000);
  const env = process.env,
    org = env[`TEST_MEETING_ORG_PROGRAMME_${info.project.name.toUpperCase()}`]!,
    name = `Local programme ${info.project.name}`,
    device = v7();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'MEETING_ADMIN', org);
  if ((page.viewportSize()?.width ?? 1440) < 760)
    await page
      .getByRole('button', { name: 'Open navigation', exact: true })
      .click();
  await page
    .getByRole('navigation', { name: 'Your workspace', exact: true })
    .getByRole('button', { name: 'Administration', exact: true })
    .click();
  const panel = page.locator('.programme-administration');
  await panel
    .locator('summary')
    .filter({ hasText: 'Create programme' })
    .click();
  await panel.getByLabel('Programme name', { exact: true }).fill(name);
  await panel.getByLabel('Country code', { exact: true }).fill('UG');
  await panel
    .getByLabel('Default currency', { exact: true })
    .selectOption('UGX');
  await panel
    .getByLabel('Programme time zone', { exact: true })
    .fill('Africa/Kampala');
  await panel
    .locator('#programme-create-reason')
    .fill('Local browser programme acceptance');
  async function save(button: () => Promise<void>) {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/admin/programmes') &&
        r.request().method() === 'POST',
    );
    await button();
    const r = await response;
    expect(r.status(), await r.text()).toBe(200);
    return r.json();
  }
  const programme = (
    await save(() =>
      panel
        .getByRole('button', { name: 'Create programme', exact: true })
        .click(),
    )
  ).id;
  await expect(
    panel.getByLabel('Choose a programme', { exact: true }),
  ).toHaveValue(programme);
  await panel
    .getByLabel('Select savings group', { exact: true })
    .selectOption(org);
  await panel
    .locator('#programme-link-reason')
    .fill('Link the local browser savings group');
  await save(() =>
    panel
      .locator('#programme-group')
      .locator('..')
      .locator('..')
      .getByRole('button')
      .click(),
  );
  await panel
    .getByLabel('Select verified existing staff', { exact: true })
    .selectOption(env['TEST_PROGRAMME_PERSON']!);
  await panel
    .locator('#programme-officer-reason')
    .fill('Grant a scoped local programme officer');
  await save(() =>
    panel
      .locator('#programme-officer')
      .locator('..')
      .locator('..')
      .getByRole('button')
      .click(),
  );
  const collector = await browser.newContext({
      baseURL: 'http://127.0.0.1:5173',
    }),
    officer = await browser.newContext({
      baseURL: 'http://127.0.0.1:5173',
      viewport: page.viewportSize()!,
    });
  try {
    await post(collector, '/api/auth/login', {
      phone: env['TEST_MEETING_SECRETARY_PHONE'],
      pin: env['TEST_PIN'],
    });
    await post(collector, '/api/auth/mfa/verify', {
      factor_id: env['TEST_MEETING_SECRETARY_FACTOR'],
      code: totp(env['TEST_MEETING_SECRETARY_TOTP']!),
    });
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 22);
    await post(collector, `/api/groups/${org}/shares`, {
      client_id: v7(),
      device_id: device,
      member_id: env['TEST_MEETING_MEMBER_PERSON'],
      meeting_date: date.toISOString().slice(0, 10),
      shares: '1',
      client_amount: '5000',
      client_calc_version: 'groups-shares-v1',
      note: 'Disposable programme meeting evidence',
    });
    const p = await officer.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await login(p, 'PROGRAMME', '');
    await expect(
      p.getByRole('heading', {
        name: 'Programme reports',
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    await p
      .getByLabel('Choose a programme', { exact: true })
      .selectOption(programme);
    const group = p.locator('.programme-group');
    await expect(group).toHaveCount(1);
    await expect(group).toContainText('No meeting in 21 days');
    await expect(group).toContainText('UGX 5,000');
    await p
      .getByLabel('Show groups', { exact: true })
      .selectOption('repayments');
    await expect(
      p.getByText('No groups match this attention filter.', { exact: true }),
    ).toBeVisible();
    await p.getByLabel('Show groups', { exact: true }).selectOption('meetings');
    await expect(group).toHaveCount(1);
    await group
      .locator('summary')
      .filter({ hasText: 'Attendance and repayment trends' })
      .click();
    await expect(group.locator('.programme-month')).toHaveCount(12);
    const download = p.waitForEvent('download');
    await p
      .getByRole('button', { name: 'Export programme CSV', exact: true })
      .click();
    await (await download).saveAs(info.outputPath('programme.csv'));
    expect(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await p.screenshot({
      path: info.outputPath('programme.png'),
      fullPage: true,
    });
    expect((await officer.request.get(`/api/groups/${org}`)).status()).toBe(
      403,
    );
    await panel.locator('#programme-officer-action').selectOption('false');
    await panel
      .locator('#programme-officer-reason')
      .fill('Revoke the local programme officer');
    await save(() =>
      panel
        .locator('#programme-officer')
        .locator('..')
        .locator('..')
        .getByRole('button')
        .click(),
    );
    await p
      .getByRole('button', { name: 'Refresh programme report', exact: true })
      .click();
    await expect(p.getByRole('alert')).toContainText(
      'Could not load programme reports',
    );
    await expect(p.locator('.programme-group')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await collector.close();
    await officer.close();
  }
});
