import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { v7 } from 'uuid';
import { totp } from '../../../scripts/totp.js';
test.skip(
  !process.env['TEST_MEETING_ADMIN_PHONE'],
  'Disposable share-out fixtures required',
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
test('two officers approve a final allocation and separate cash receipts close the cycle', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150000);
  const env = process.env,
    org = env[`TEST_MEETING_ORG_SHAREOUT_${info.project.name.toUpperCase()}`]!,
    device = v7(),
    root = `/api/groups/${org}`;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'MEETING_ADMIN', org);
  await post(page.context(), `/api/admin/groups/${org}/social`, {
    request_id: v7(),
    device_id: device,
    amount: '1000',
    roles: ['treasurer'],
    separate: true,
    require_all: false,
  });
  const sc = await browser.newContext({
    baseURL: 'http://127.0.0.1:5173',
    viewport: page.viewportSize()!,
  });
  const tc = await browser.newContext({
    baseURL: 'http://127.0.0.1:5173',
    viewport: page.viewportSize()!,
  });
  try {
    await sc.addInitScript(
      ({ org, device }) => localStorage.setItem(`yapesa-device-${org}`, device),
      { org, device },
    );
    const sec = await sc.newPage(),
      treas = await tc.newPage();
    sec.on('pageerror', (e) => errors.push(e.message));
    await login(sec, 'MEETING_SECRETARY', org);
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
      mid = (await post(sc, `${root}/meetings`, meeting('open', { date }))).id;
    for (const [label, shares] of [
      ['MEETING_SECRETARY', '2'],
      ['MEETING_MEMBER', '1'],
    ]) {
      await post(sc, `${root}/shares`, {
        client_id: v7(),
        device_id: device,
        member_id: env[`TEST_${label}_PERSON`],
        meeting_date: date,
        shares,
        client_amount: String(BigInt(shares!) * 5000n),
        client_calc_version: 'groups-shares-v1',
        note: 'Share-out browser fixture',
      });
      await post(
        sc,
        `${root}/meetings`,
        meeting('attendance', {
          meeting_id: mid,
          member_id: env[`TEST_${label}_PERSON`],
          status: 'present',
        }),
      );
    }
    await post(sc, `${root}/social`, {
      request_id: v7(),
      device_id: device,
      action: 'contribute',
      meeting_id: mid,
      member_id: env['TEST_MEETING_MEMBER_PERSON'],
      amount: null,
      target_id: null,
      reason: '',
    });
    await post(
      sc,
      `${root}/meetings`,
      meeting('propose', {
        meeting_id: mid,
        counted_cash: '16000',
        explanation: '',
      }),
    );
    const meetingResponse = await sc.request.get(`${root}/meetings`);
    expect(meetingResponse.status()).toBe(200);
    const closing = (await meetingResponse.json()).meetings.find(
      (m: { id: string }) => m.id === mid,
    ).proposal.id;
    await post(
      sc,
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
    await sec.reload();
    const panel = sec.locator('.final-shareout');
    await expect(panel).toContainText('Ready to prepare an allocation');
    await panel
      .getByRole('checkbox', {
        name: 'I have reviewed the fund and want to prepare this cycle for final share-out.',
        exact: true,
      })
      .check();
    await panel
      .getByRole('button', { name: 'Prepare final allocation', exact: true })
      .click();
    await expect(
      panel.getByRole('table', { name: 'Final share-out allocation' }),
    ).toBeVisible();
    await panel
      .getByRole('checkbox', {
        name: 'I have reviewed every allocation and approve this final distribution.',
        exact: true,
      })
      .check();
    await panel
      .getByRole('button', { name: 'Approve final allocation', exact: true })
      .click();
    await expect(panel).toContainText('Your approval is recorded.');
    await expect(
      panel.getByRole('button', { name: 'Record cash payout', exact: true }),
    ).toHaveCount(0);
    await treas.reload();
    const tp = treas.locator('.final-shareout');
    await expect(tp).toContainText('Current officer approvals: 1 / 2');
    await tp
      .getByRole('checkbox', {
        name: 'I have reviewed every allocation and approve this final distribution.',
        exact: true,
      })
      .check();
    await tp
      .getByRole('button', { name: 'Approve final allocation', exact: true })
      .click();
    await expect(tp).toContainText('Allocation approved.');
    await panel
      .getByRole('button', { name: 'Refresh final share-out', exact: true })
      .click();
    await expect(panel).toContainText('Allocation approved.');
    await expect(
      panel.getByRole('button', { name: 'Finalize cycle', exact: true }),
    ).toHaveCount(0);
    let interrupted = false;
    await sec.route('**/api/groups/*/shareout', async (route) => {
      if (
        route.request().method() !== 'POST' ||
        route.request().postDataJSON().action !== 'pay'
      ) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      if (!interrupted) {
        interrupted = true;
        await route.abort('failed');
      } else await route.fulfill({ response });
    });
    for (let n = 0; n < 2; n++) {
      const select = panel.getByLabel('Member receiving the payout', {
        exact: true,
      });
      await expect(select).toBeEnabled();
      const value = await select.locator('option').nth(1).getAttribute('value');
      await select.selectOption(value!);
      await panel
        .getByLabel('Receipt reference or payout note', { exact: true })
        .fill(`Cash acknowledged ${n + 1}`);
      await panel
        .getByRole('checkbox', {
          name: 'I handed this member the full amount shown and received their acknowledgement.',
          exact: true,
        })
        .check();
      await panel
        .getByRole('button', { name: 'Record cash payout', exact: true })
        .click();
      if (n === 0) {
        await expect(panel).toContainText('The result is not yet confirmed.');
        await panel
          .getByRole('button', {
            name: 'Retry the same share-out command',
            exact: true,
          })
          .click();
      }
      await expect(
        panel.getByRole('button', {
          name: 'Refresh final share-out',
          exact: true,
        }),
      ).toBeEnabled();
      await expect(panel).toContainText('Share-out record saved.');
    }
    await expect(
      panel.getByText('Cash handover recorded', { exact: true }),
    ).toHaveCount(2);
    await panel
      .getByRole('checkbox', {
        name: 'Every positive allocation has a cash receipt. I confirm the cycle can close.',
        exact: true,
      })
      .check();
    await panel
      .getByRole('button', { name: 'Finalize cycle', exact: true })
      .click();
    await expect(panel).toContainText(
      'Cycle finalized. All payouts are recorded; the Social reserve is retained.',
    );
    const download = sec.waitForEvent('download');
    await panel
      .getByRole('button', { name: 'Export payout register', exact: true })
      .click();
    const csv = await download;
    expect(csv.suggestedFilename()).toMatch(/^yapesa-shareout-.+\.csv$/);
    await csv.saveAs(info.outputPath('payouts.csv'));
    await expect(sec.getByLabel('Shares to buy', { exact: true })).toHaveCount(
      0,
    );
    expect(
      await sec.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await panel.scrollIntoViewIfNeeded();
    await sec.screenshot({
      path: info.outputPath('shareout-verified.png'),
      fullPage: true,
    });
  } finally {
    await sc.close();
    await tc.close();
  }
});
