import { test, expect } from '@playwright/test';
import { totp } from '../../../scripts/totp.js';
test.skip(
  !process.env['TEST_ADMIN_PHONE'],
  'Requires disposable local administration fixtures',
);

test('administrator creates a group once, adds a member, assigns a secretary and records shares', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const env = process.env;
  const name = `Admin browser group ${info.project.name}`;
  const memberName = `Registered member ${info.project.name}`;
  const today = new Date().toISOString().slice(0, 10);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#live');
  await page
    .getByLabel('Phone number', { exact: true })
    .fill(env['TEST_ADMIN_PHONE']!);
  await page.getByLabel('6-digit PIN', { exact: true }).fill(env['TEST_PIN']!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Verify your sign-in', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(totp(env['TEST_ADMIN_TOTP']!));
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  if ((page.viewportSize()?.width ?? 1440) < 760)
    await page
      .getByRole('button', { name: 'Open navigation', exact: true })
      .click();
  await page
    .getByRole('navigation', { name: 'Your workspace', exact: true })
    .getByRole('button', { name: 'Administration', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Administration', exact: true }),
  ).toBeVisible();
  const create = page.getByRole('region', {
    name: 'Create a savings group',
    exact: true,
  });
  await create.getByLabel('Group name', { exact: true }).fill(name);
  await create.getByLabel('Country code', { exact: true }).fill('UG');
  await create.getByLabel('Currency', { exact: true }).selectOption('UGX');
  await create.getByLabel('Time zone', { exact: true }).fill('Africa/Kampala');
  await create
    .getByLabel('Maximum shares per member per meeting', { exact: true })
    .fill('5');
  await create.getByLabel('Cycle starts', { exact: true }).fill(today);
  await create.getByLabel('Cycle ends', { exact: true }).fill('2099-12-31');
  await create
    .getByLabel('Price per share (UGX)', { exact: true })
    .fill('5000');
  let interrupted = false;
  const references: string[] = [];
  await page.route('**/api/admin/groups', async (route) => {
    references.push(route.request().postDataJSON().request_id);
    const response = await route.fetch();
    if (!interrupted) {
      interrupted = true;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await create
    .getByRole('button', { name: 'Create a savings group', exact: true })
    .click();
  await expect(
    create.getByRole('button', { name: 'Retry this change', exact: true }),
  ).toBeVisible();
  await expect(create.getByLabel('Group name', { exact: true })).toBeDisabled();
  await create
    .getByRole('button', { name: 'Retry this change', exact: true })
    .click();
  const manage = page.getByRole('region', {
    name: 'Manage a group',
    exact: true,
  });
  await expect(
    manage.getByLabel('Choose a group', { exact: true }),
  ).toHaveValue(/.+/);
  await expect(manage.getByLabel('Group name', { exact: true })).toHaveValue(
    name,
  );
  expect(references).toHaveLength(2);
  expect(references[0]).toBe(references[1]);
  await expect(
    manage
      .getByLabel('Choose a group', { exact: true })
      .getByRole('option', { name, exact: true }),
  ).toHaveCount(1);
  const members = page.getByRole('region', {
    name: 'Add a member',
    exact: true,
  });
  await members.getByLabel('Full name', { exact: true }).fill(memberName);
  await members
    .getByRole('button', { name: 'Add a member', exact: true })
    .click();
  await expect(
    page.getByRole('cell', { name: memberName, exact: true }),
  ).toBeVisible();
  const roles = page.getByRole('region', { name: 'Group roles', exact: true });
  await roles
    .getByLabel('Person to update', { exact: true })
    .selectOption(env['TEST_ADMIN_PERSON']!);
  await roles.getByLabel('Role', { exact: true }).selectOption('secretary');
  await roles
    .getByRole('button', { name: 'Save role assignment', exact: true })
    .click();
  await expect(
    page.getByRole('cell', { name: 'Secretary', exact: true }),
  ).toBeVisible();
  const layout = await page.evaluate(() => ({
    width: window.innerWidth,
    content: document.documentElement.scrollWidth,
    scrollX: window.scrollX,
    overflowing: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.width > 0 && box.right + window.scrollX > window.innerWidth + 1
        );
      })
      .slice(0, 30)
      .map((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName,
          class: element.className,
          left: box.left + window.scrollX,
          right: box.right + window.scrollX,
          width: box.width,
          minWidth: style.minWidth,
          display: style.display,
          overflow: style.overflowX,
        };
      }),
  }));
  expect(layout.content <= layout.width, JSON.stringify(layout)).toBe(true);
  await page.screenshot({
    path: info.outputPath('group-administration.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Back to saved records', exact: true })
    .click();
  await page
    .getByLabel('Choose a savings group', { exact: true })
    .selectOption({ label: name });
  await expect(
    page.getByRole('heading', { name, level: 1, exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Member', { exact: true })
    .selectOption({ label: memberName });
  await page.getByLabel('Number of shares', { exact: true }).fill('1');
  await page
    .getByRole('button', { name: 'Save to group', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Share purchase saved.');
  await page.reload();
  await page
    .getByLabel('Choose a savings group', { exact: true })
    .selectOption({ label: name });
  await expect(
    page.locator('.record-row').filter({ hasText: memberName }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});
