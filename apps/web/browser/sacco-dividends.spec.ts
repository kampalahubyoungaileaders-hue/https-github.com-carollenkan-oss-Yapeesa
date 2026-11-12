import { test, expect } from '@playwright/test';

test('dividend view separates approval from posted member credits and keeps product scope', async ({
  page,
}) => {
  const org = '00000000-0000-4000-8000-000000000010';
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    expect(route.request().method()).toBe('GET');
    requests.push(url.pathname + url.search);
    if (url.pathname === '/api/session')
      return route.fulfill({
        json: {
          configured: true,
          user: {
            person_id: '00000000-0000-4000-8000-000000000011',
            display_name: 'Fixture manager',
            requires_mfa: true,
            mfa_verified: true,
            factors: [],
            can_administer: false,
          },
        },
      });
    if (['/api/groups', '/api/programmes'].includes(url.pathname))
      return route.fulfill({ json: [] });
    if (url.pathname === '/api/saccos')
      return route.fulfill({
        json: [
          { id: org, name: 'Fixture SACCO', currency: 'UGX', can_work: true },
        ],
      });
    if (url.pathname === `/api/saccos/${org}`)
      return route.fulfill({ json: { configured: true, linked: true } });
    if (url.pathname.endsWith('/catalog'))
      return route.fulfill({
        json: {
          resources: [
            {
              id: 'dividends',
              label: 'Dividend postings',
              detail: true,
              page: true,
            },
          ],
          operations: [],
        },
      });
    if (url.pathname.endsWith('/records/dividends')) {
      expect(url.searchParams.get('product')).toBe('42');
      const detail = url.searchParams.get('record');
      expect(detail === null || detail === '7').toBe(true);
      const offset = url.searchParams.get('offset') ?? '0';
      expect(['0', '50']).toContain(offset);
      const start = Number(offset);
      return route.fulfill({
        json: {
          totalFilteredRecords: detail ? '51' : '1',
          pageItems: detail
            ? Array.from({ length: start === 0 ? 50 : 1 }, (_, index) => {
                const n = start + index;
                return {
                  id: String(8 + n),
                  accountData: {
                    accountNo: `SH-${String(8 + n).padStart(4, '0')}`,
                  },
                  amount: '1000',
                  status: {
                    code: 'shareAccountDividendStatusType.posted',
                    value: 'Posted',
                  },
                  savingsTransactionId: String(9007199254740993n + BigInt(n)),
                };
              })
            : [{ id: '7', amount: '51000', status: { value: 'Approved' } }],
        },
      });
    }
    throw new Error(`Unexpected API request: ${url.pathname}`);
  });
  await page.goto('/#live');
  await expect(
    page.getByRole('heading', { name: 'Dividend postings', exact: true }),
  ).toBeVisible();
  expect(requests.some((url) => url.includes('/records/'))).toBe(false);
  await page.getByLabel('Product reference', { exact: true }).fill('42');
  await expect(
    page.getByRole('cell', { name: 'Approved', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Approval and posting are separate steps.', {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Dividend allocations', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Posted', exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'SH-0008', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: '9007199254740993', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const allocations = page
    .getByRole('heading', { name: 'Dividend allocations', exact: true })
    .locator('..');
  await allocations
    .getByRole('button', { name: 'Next page', exact: true })
    .click();
  await expect(
    page.getByRole('cell', { name: 'SH-0058', exact: true }),
  ).toBeVisible();
  await expect(
    allocations.getByRole('button', { name: 'Next page', exact: true }),
  ).toBeDisabled();
  await allocations
    .getByRole('button', { name: 'Previous page', exact: true })
    .click();
  await expect(
    page.getByRole('cell', { name: 'SH-0008', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: '9007199254740993', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Product reference', { exact: true }).clear();
  await expect(
    page.getByRole('cell', { name: '9007199254740993', exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
