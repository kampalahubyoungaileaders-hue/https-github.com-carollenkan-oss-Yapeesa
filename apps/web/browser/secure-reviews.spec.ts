import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { v7 } from 'uuid';
import { totp } from '../../../scripts/totp.js';
test.skip(
  !process.env['TEST_MEETING_ADMIN_PHONE'],
  'Disposable review fixtures required',
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

test('two group officers resolve calculation and closed-meeting reviews while money stays locked', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150000);
  const env = process.env,
    org = env[`TEST_MEETING_ORG_REVIEWS_${info.project.name.toUpperCase()}`]!,
    device = v7(),
    root = `/api/groups/${org}`;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page
    .context()
    .addInitScript(
      ({ org, device }) => localStorage.setItem(`yapesa-device-${org}`, device),
      { org, device },
    );
  await login(page, 'MEETING_SECRETARY', org);
  const tc = await browser.newContext({
    baseURL: 'http://127.0.0.1:5173',
    viewport: page.viewportSize()!,
  });
  try {
    const treas = await tc.newPage();
    await login(treas, 'MEETING_TREASURER', org);
    const meeting = (action: string, extra: object = {}) => ({
      request_id: v7(),
      device_id: device,
      action,
      date: null,
      meeting_id: null,
      member_id: null,
      status: null,
      counted_cash: null,
      explanation: null,
      proposal_id: null,
      ...extra,
    });
    const date = new Date().toISOString().slice(0, 10),
      mid = (
        await post(
          page.context(),
          `${root}/meetings`,
          meeting('open', { date }),
        )
      ).id;
    await post(page.context(), `${root}/shares`, {
      client_id: v7(),
      device_id: device,
      member_id: env['TEST_MEETING_SECRETARY_PERSON'],
      meeting_date: date,
      shares: '1',
      client_amount: '4999',
      client_calc_version: 'old-client-v0',
      note: 'Mismatch for officer review',
    });
    async function nav(p: Page) {
      if ((p.viewportSize()?.width ?? 1440) < 760)
        await p
          .getByRole('button', { name: 'Open navigation', exact: true })
          .click();
      await p.getByRole('button', { name: 'Reviews', exact: true }).click();
      await expect(
        p.getByRole('button', { name: 'Refresh reviews', exact: true }),
      ).toBeEnabled();
    }
    await page
      .getByRole('button', { name: 'Refresh records', exact: true })
      .click();
    await expect(page.locator('.live-stats')).toContainText('UGX 5,000');
    await nav(page);
    const panel = page.locator('.reviews-workspace');
    await expect(panel).toContainText('Local MEETING_SECRETARY');
    await panel
      .locator('.review-difference')
      .getByLabel('Reason and supporting details', { exact: true })
      .fill('Compare the saved old client amount with the signed cash record');
    await panel
      .getByRole('button', { name: 'Open calculation review', exact: true })
      .click();
    let card = panel.locator('.review-case').first();
    await expect(card).toBeVisible();
    await card.getByText('Propose review outcome', { exact: true }).click();
    await card
      .getByLabel('Review outcome', { exact: true })
      .selectOption('confirmed');
    await card
      .getByLabel('Reason for the proposed outcome', { exact: true })
      .fill('The server amount agrees with the cash and share price');
    await card
      .getByRole('button', { name: 'Save proposed outcome', exact: true })
      .click();
    await expect(card).toContainText('Current officer approvals: 0 / 2');
    await card
      .getByRole('checkbox', {
        name: 'I reviewed the original evidence and agree with this proposed outcome and reason.',
        exact: true,
      })
      .check();
    await card
      .getByRole('button', { name: 'Approve review outcome', exact: true })
      .click();
    await expect(card).toContainText('Your approval is recorded.');
    await nav(treas);
    let tcCard = treas.locator('.review-case').first();
    await expect(tcCard).toContainText('Current officer approvals: 1 / 2');
    await tcCard.getByRole('checkbox').check();
    await tcCard
      .getByRole('button', { name: 'Approve review outcome', exact: true })
      .click();
    await expect(tcCard).toContainText(
      'Two-officer decision recorded: Original records confirmed',
    );
    // Closing remains a separate, unchanged financial command.
    for (const label of ['MEETING_SECRETARY', 'MEETING_MEMBER'])
      await post(
        page.context(),
        `${root}/meetings`,
        meeting('attendance', {
          meeting_id: mid,
          member_id: env[`TEST_${label}_PERSON`],
          status: 'present',
        }),
      );
    await post(
      page.context(),
      `${root}/meetings`,
      meeting('propose', {
        meeting_id: mid,
        counted_cash: '5000',
        explanation: '',
      }),
    );
    let response = await page.context().request.get(`${root}/meetings`);
    expect(response.status()).toBe(200);
    const closing = (await response.json()).meetings.find(
      (m: { id: string }) => m.id === mid,
    ).proposal.id;
    await post(
      page.context(),
      `${root}/meetings`,
      meeting('approve', { meeting_id: mid, proposal_id: closing }),
    );
    await post(
      tc,
      `${root}/meetings`,
      meeting('approve', {
        meeting_id: mid,
        proposal_id: closing,
        device_id: v7(),
      }),
    );
    await panel
      .getByRole('button', { name: 'Refresh reviews', exact: true })
      .click();
    await expect(panel).toContainText(
      'Two-officer decision recorded: Original records confirmed',
    );
    await panel
      .getByLabel('Closed record to review', { exact: true })
      .selectOption(`meeting:${mid}`);
    const closed = panel
      .getByRole('heading', {
        name: 'Request a closed-record review',
        exact: true,
      })
      .locator('..');
    await closed
      .getByLabel('Reason and supporting details', { exact: true })
      .fill('Check a disputed closed meeting without reopening its ledger');
    await closed
      .getByRole('button', { name: 'Save review request', exact: true })
      .click();
    card = panel.locator('.review-case').first();
    await expect(card).toContainText('Check a disputed closed meeting');
    await card.getByText('Propose review outcome', { exact: true }).click();
    await card
      .getByLabel('Review outcome', { exact: true })
      .selectOption('correction_required');
    await card
      .getByLabel('Reason for the proposed outcome', { exact: true })
      .fill(
        'A correction needs a separate worked and approved adjustment policy',
      );
    await card
      .getByRole('button', { name: 'Save proposed outcome', exact: true })
      .click();
    await card.getByRole('checkbox').check();
    await card
      .getByRole('button', { name: 'Approve review outcome', exact: true })
      .click();
    await expect(card).toContainText('Your approval is recorded.');
    await treas
      .getByRole('button', { name: 'Refresh reviews', exact: true })
      .click();
    tcCard = treas.locator('.review-case').first();
    await expect(tcCard).toContainText('Current officer approvals: 1 / 2');
    await tcCard.getByRole('checkbox').check();
    await tcCard
      .getByRole('button', { name: 'Approve review outcome', exact: true })
      .click();
    await expect(tcCard).toContainText(
      'Correction required — awaiting an approved adjustment process',
    );
    await panel
      .getByRole('button', { name: 'Refresh reviews', exact: true })
      .click();
    await expect(card).toContainText('The original ledger remains locked.');
    response = await page.context().request.get(root);
    expect(response.status()).toBe(200);
    const original = (await response.json()).transactions;
    expect(original).toHaveLength(1);
    expect(original[0].amount).toBe('5000');
    expect(original[0].calculation_mismatch).toBe(true);
    const download = page.waitForEvent('download');
    await panel
      .getByRole('button', { name: 'Export review register', exact: true })
      .click();
    await (await download).saveAs(info.outputPath('reviews.csv'));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: info.outputPath('reviews-verified.png'),
      fullPage: true,
    });
  } finally {
    await tc.close();
  }
});
