import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { v7 } from 'uuid';
import { buildApp } from '../apps/api/src/app.js';
import { readConfig } from '../apps/api/src/config.js';
import { openTokens } from '../apps/api/src/security.js';
import { totp } from '../scripts/totp.js';

const env = process.env;
const config = readConfig();
assert(config);
for (const url of [config.supabaseUrl, env['TEST_DB_URL']!])
  assert(
    ['127.0.0.1', 'localhost'].includes(new URL(url).hostname),
    'Local administration fixtures only',
  );
const app = buildApp(config);
const db = new pg.Client({ connectionString: env['TEST_DB_URL'] });
await db.connect();
const cookies = new Map<string, string>();
async function call(
  label: string,
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
) {
  const response = await app.inject({
    method,
    url,
    headers: {
      origin: config!.webOrigin,
      ...(cookies.has(label) ? { cookie: cookies.get(label)! } : {}),
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
    remoteAddress: label === 'ADMIN' ? '127.0.0.24' : '127.0.0.23',
  });
  for (const cookie of response.cookies)
    if (cookie.name === 'yapesa_session')
      cookies.set(label, `${cookie.name}=${cookie.value}`);
  return response;
}
function token(label: string) {
  return openTokens(
    cookies.get(label)!.slice('yapesa_session='.length),
    config!.cookieKey,
  ).access_token;
}
async function direct(
  label: string,
  path: string,
  body: unknown,
  method = 'POST',
) {
  return fetch(`${config!.supabaseUrl}${path}`, {
    method,
    headers: {
      apikey: config!.publishableKey,
      Authorization: `Bearer ${token(label)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
test('real verified administration creates a usable group and rejects elevation, replay conflicts and historical edits', async () => {
  const device_id = v7();
  const input = {
    request_id: v7(),
    device_id,
    name: 'Integration administered group',
    country_code: 'UG',
    currency: 'UGX',
    time_zone: 'Africa/Kampala',
    max_shares: '5',
    starts_on: new Date().toISOString().slice(0, 10),
    ends_on: '2099-12-31',
    share_price: '1000',
  };
  assert.equal(
    (await call('NONE', 'GET', '/api/admin/workspace')).statusCode,
    401,
  );
  const memberLogin = await call('MEMBER', 'POST', '/api/auth/login', {
    phone: env['TEST_MEMBER_PHONE'],
    pin: env['TEST_PIN'],
  });
  assert.equal(memberLogin.statusCode, 200, memberLogin.body);
  assert.equal(
    (await call('MEMBER', 'POST', '/api/admin/groups', input)).statusCode,
    403,
  );
  const metadata = await direct(
    'MEMBER',
    '/auth/v1/user',
    { data: { can_administer: true, role: 'fencher_admin' } },
    'PUT',
  );
  assert.equal(metadata.status, 200);
  assert.equal(
    (await call('MEMBER', 'GET', '/api/admin/workspace')).statusCode,
    403,
    'User metadata is not an administration authority',
  );
  const login = await call('ADMIN', 'POST', '/api/auth/login', {
    phone: env['TEST_ADMIN_PHONE'],
    pin: env['TEST_PIN'],
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().user.can_administer, false);
  assert.equal(
    (await call('ADMIN', 'GET', '/api/admin/workspace')).statusCode,
    403,
    'First factor is insufficient',
  );
  const verified = await call('ADMIN', 'POST', '/api/auth/mfa/verify', {
    factor_id: env['TEST_ADMIN_FACTOR'],
    code: totp(env['TEST_ADMIN_TOTP']!),
  });
  assert.equal(verified.statusCode, 200, verified.body);
  assert.equal(verified.json().user.can_administer, true);
  const workspace = await call('ADMIN', 'GET', '/api/admin/workspace');
  assert.equal(workspace.statusCode, 200, workspace.body);
  assert(
    workspace
      .json()
      .currencies.some((currency: { code: string }) => currency.code === 'UGX'),
  );
  for (const invalid of [
    { share_price: '1.5' },
    { max_shares: '0' },
    { currency: 'BAD' },
    { time_zone: 'Not/AZone' },
    { starts_on: '2100-01-01' },
    { share_price: '9999999999999999999' },
  ]) {
    const response = await call('ADMIN', 'POST', '/api/admin/groups', {
      ...input,
      ...invalid,
      request_id: v7(),
    });
    assert([400, 422].includes(response.statusCode), response.body);
  }
  const created = await call('ADMIN', 'POST', '/api/admin/groups', input);
  assert.equal(created.statusCode, 200, created.body);
  const group = created.json().id as string;
  const replay = await call('ADMIN', 'POST', '/api/admin/groups', input);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), created.json());
  assert.equal(
    (
      await call('ADMIN', 'POST', '/api/admin/groups', {
        ...input,
        name: 'Changed payload',
      })
    ).statusCode,
    409,
  );
  const count = await db.query<{ count: string }>(
    'select count(*)::text as count from public.organisation where name=$1',
    [input.name],
  );
  assert.equal(count.rows[0]!.count, '1');
  assert.equal(
    (
      await direct('ADMIN', '/rest/v1/organisation', {
        name: 'Forbidden direct write',
        type: 'group',
        country_code: 'UG',
        currency: 'UGX',
        time_zone: 'Africa/Kampala',
      })
    ).status,
    403,
  );
  const denied = await direct('MEMBER', '/rest/v1/rpc/admin_set_role', {
    p_request: v7(),
    p_device: device_id,
    p_org: group,
    p_person: env['TEST_MEMBER_PERSON'],
    p_role: 'secretary',
    p_enabled: true,
  });
  assert.equal(denied.status, 403);
  const newMember = {
    request_id: v7(),
    device_id,
    existing_person: null,
    name: 'Integration registered member',
    phone: '+256700000099',
  };
  const member = await call(
    'ADMIN',
    'POST',
    `/api/admin/groups/${group}/members`,
    newMember,
  );
  assert.equal(member.statusCode, 200, member.body);
  const person = member.json().id as string;
  assert.deepEqual(
    (
      await call(
        'ADMIN',
        'POST',
        `/api/admin/groups/${group}/members`,
        newMember,
      )
    ).json(),
    member.json(),
  );
  const memberRecord = await db.query<{ auth_user_id: string | null }>(
    'select auth_user_id from public.person where id=$1',
    [person],
  );
  assert.equal(
    memberRecord.rows[0]!.auth_user_id,
    null,
    'Ledger registration cannot create Auth accounts',
  );
  const roleBody = {
    request_id: v7(),
    device_id,
    person_id: person,
    role: 'secretary',
    enabled: true,
  };
  assert.equal(
    (await call('ADMIN', 'POST', `/api/admin/groups/${group}/roles`, roleBody))
      .statusCode,
    422,
    'Unverified ledger member cannot become staff',
  );
  assert.equal(
    (
      await call('ADMIN', 'POST', `/api/admin/groups/${group}/roles`, {
        ...roleBody,
        role: 'fencher_admin',
      })
    ).statusCode,
    400,
  );
  const elevated = await direct('ADMIN', '/rest/v1/rpc/admin_set_role', {
    p_request: v7(),
    p_device: device_id,
    p_org: group,
    p_person: person,
    p_role: 'fencher_admin',
    p_enabled: true,
  });
  assert.equal(
    elevated.status,
    400,
    'Database rejects forbidden platform-role assignment',
  );
  const grant = await call(
    'ADMIN',
    'POST',
    `/api/admin/groups/${group}/roles`,
    { ...roleBody, request_id: v7(), person_id: env['TEST_ADMIN_PERSON'] },
  );
  assert.equal(grant.statusCode, 200, grant.body);
  const settings = {
    request_id: v7(),
    device_id,
    name: input.name,
    max_shares: '6',
    starts_on: input.starts_on,
    ends_on: input.ends_on,
    share_price: '1000',
  };
  assert.equal(
    (
      await call('ADMIN', 'POST', `/api/admin/groups/${group}/settings`, {
        ...settings,
        request_id: v7(),
        share_price: '2000',
      })
    ).statusCode,
    422,
    'Cycle price stays fixed even before posting',
  );
  const updated = await call(
    'ADMIN',
    'POST',
    `/api/admin/groups/${group}/settings`,
    settings,
  );
  if (updated.statusCode !== 200) {
    // Local-only diagnostics reveal the database failure behind the API's safe
    // generic error. No Auth headers, tokens or credentials are printed.
    const detail = await direct('ADMIN', '/rest/v1/rpc/admin_configure_group', {
      p_request: settings.request_id,
      p_device: settings.device_id,
      p_org: group,
      p_name: settings.name,
      p_max: settings.max_shares,
      p_starts: settings.starts_on,
      p_ends: settings.ends_on,
      p_price: settings.share_price,
    });
    assert.equal(detail.status, 200, await detail.text());
  }
  assert.equal(updated.statusCode, 200, updated.body);
  const purchase = await call('ADMIN', 'POST', `/api/groups/${group}/shares`, {
    member_id: person,
    meeting_date: input.starts_on,
    shares: '1',
    client_id: v7(),
    device_id,
    client_amount: '1000',
    client_calc_version: 'groups-shares-v1',
    note: 'Administration integration',
  });
  assert.equal(purchase.statusCode, 200, purchase.body);
  assert.equal(purchase.json().amount, '1000');
  assert.equal(
    (
      await call('ADMIN', 'POST', `/api/admin/groups/${group}/settings`, {
        ...settings,
        request_id: v7(),
        share_price: '3000',
      })
    ).statusCode,
    422,
    'Posted cycle settings stay immutable',
  );
  const after = await call('ADMIN', 'GET', '/api/admin/workspace');
  assert.equal(after.statusCode, 200, after.body);
  const savedGroup = after
    .json()
    .groups.find((item: { id: string }) => item.id === group);
  assert.equal(savedGroup.configuration_locked, true);
  assert.equal(savedGroup.cycle.share_price, '1000');
  const removedMember = await call(
    'ADMIN',
    'POST',
    `/api/admin/groups/${group}/roles`,
    {
      request_id: v7(),
      device_id,
      person_id: person,
      role: 'member',
      enabled: false,
    },
  );
  assert.equal(removedMember.statusCode, 200, removedMember.body);
  const history = await call('ADMIN', 'GET', `/api/groups/${group}`);
  assert.equal(history.statusCode, 200, history.body);
  assert.equal(
    history.json().members.find((item: { id: string }) => item.id === person)
      .name,
    newMember.name,
  );
  assert.equal(
    history.json().members.find((item: { id: string }) => item.id === person)
      .active,
    false,
  );
  assert.equal(
    history.json().transactions.length,
    1,
    'Role removal preserves financial history',
  );
  const revoked = await call(
    'ADMIN',
    'POST',
    `/api/admin/groups/${group}/roles`,
    {
      ...roleBody,
      request_id: v7(),
      person_id: env['TEST_ADMIN_PERSON'],
      enabled: false,
    },
  );
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal(
    (await call('ADMIN', 'GET', `/api/groups/${group}`)).json().group
      .can_record,
    false,
    'Platform administration alone does not grant transaction posting',
  );
  await db.query(
    'update public.membership set ends_at=clock_timestamp() where person_id=$1 and organisation_id=$2 and role=$3',
    [env['TEST_ADMIN_PERSON'], env['TEST_PLATFORM_ORG'], 'fencher_admin'],
  );
  assert.equal(
    (await call('ADMIN', 'GET', '/api/admin/workspace')).statusCode,
    403,
    'Revocation takes effect with the same cookie',
  );
  assert.equal(
    (await call('ADMIN', 'POST', '/api/admin/groups', input)).statusCode,
    403,
    'Revoked administrator cannot replay a saved command',
  );
  await db.query(
    'update public.membership set ends_at=null where person_id=$1 and organisation_id=$2 and role=$3',
    [env['TEST_ADMIN_PERSON'], env['TEST_PLATFORM_ORG'], 'fencher_admin'],
  );
  await db.query(
    "update auth.mfa_factors set status='unverified' where id=$1",
    [env['TEST_ADMIN_FACTOR']],
  );
  assert.equal(
    (await call('ADMIN', 'GET', '/api/admin/workspace')).statusCode,
    403,
    'Factor revocation takes effect with the same cookie',
  );
  await db.query("update auth.mfa_factors set status='verified' where id=$1", [
    env['TEST_ADMIN_FACTOR'],
  ]);
  await assert.rejects(
    db.query('update private.admin_receipt set result=$1 where request_id=$2', [
      {},
      input.request_id,
    ]),
    (error: unknown) => {
      assert(error && typeof error === 'object' && 'code' in error);
      return error.code === '55000';
    },
  );
  const audit = await db.query<{ count: string }>(
    "select count(*)::text as count from public.audit_log where organisation_id=$1 and action='create_group'",
    [group],
  );
  assert.equal(audit.rows[0]!.count, '1');
});
test.after(async () => {
  await app.close();
  await db.end();
});
