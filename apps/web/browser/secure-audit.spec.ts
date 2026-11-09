import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { v7 } from 'uuid';
import { totp } from '../../../scripts/totp.js';
test.skip(
  !process.env['TEST_MEETING_ADMIN_PHONE'],
  'Disposable audit fixtures required',
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
  const picker = page.getByLabel('Choose a savings group', { exact: true });
  await expect(picker).toBeEnabled();
  await picker.selectOption(org);
  await expect(picker).toHaveValue(org);
}
async function post(context: BrowserContext, url: string, data: object) {
  const r = await context.request.post(url, {
    data,
    headers: { origin: 'http://127.0.0.1:5173' },
  });
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}

test('verified officer downloads a scoped audit PDF on desktop and phone', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const env = process.env,
    org = env[`TEST_MEETING_ORG_AUDIT_${info.project.name.toUpperCase()}`]!,
    root = `/api/groups/${org}`;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'MEETING_SECRETARY', org);
  const saved = await post(page.context(), `${root}/shares`, {
    client_id: v7(),
    device_id: v7(),
    member_id: env['TEST_MEETING_MEMBER_PERSON'],
    meeting_date: new Date().toISOString().slice(0, 10),
    shares: '1',
    client_amount: '5000',
    client_calc_version: 'groups-shares-v1',
    note: 'Disposable browser audit',
  });
  await page
    .getByRole('button', { name: 'Refresh records', exact: true })
    .click();
  await expect(page.locator('.live-stats')).toContainText('UGX 5,000');
  if ((page.viewportSize()?.width ?? 1440) < 760)
    await page
      .getByRole('button', { name: 'Open navigation', exact: true })
      .click();
  await page
    .getByRole('button', { name: 'Audit extract', exact: true })
    .click();
  await page
    .getByLabel('Audit actions from', { exact: true })
    .fill('2000-01-01');
  await page
    .getByLabel('Audit actions through', { exact: true })
    .fill('2099-12-31');
  await page
    .getByLabel('Record or journal reference (optional)', { exact: true })
    .fill(saved.transaction_id);
  const pending = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Download audit PDF', exact: true })
    .click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(`yapesa-audit-${org}.pdf`);
  await download.saveAs(info.outputPath('audit-fixture.pdf'));
  expect(await download.failure()).toBeNull();
  await expect(
    page.getByText('Your audit download has started.', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('audit.png'), fullPage: true });
});
