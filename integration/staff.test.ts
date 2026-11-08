import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { v7 } from 'uuid';
import { buildApp } from '../apps/api/src/app.js';
import { readConfig } from '../apps/api/src/config.js';
import { openTokens } from '../apps/api/src/security.js';
import { totp } from '../scripts/totp.js';
const env = process.env,
  config = readConfig();
assert(config);
for (const url of [config.supabaseUrl, env['TEST_DB_URL']!])
  assert(
    ['localhost', '127.0.0.1'].includes(new URL(url).hostname),
    'Disposable staff accounts only',
  );
// Diagnostics are limited to disposable local RPC errors, never Auth payloads.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await originalFetch(input, init);
  const url = new URL(String(input));
  if (
    !response.ok &&
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
    url.pathname.startsWith('/rest/v1/rpc/staff_')
  ) {
    const error = (await response.clone().json()) as {
      code?: string;
      message?: string;
      hint?: string;
    };
    console.error(
      'Local staff RPC diagnostic',
      url.pathname,
      error.code,
      error.message,
      error.hint,
    );
  }
  return response;
};
const app = buildApp(config),
  db = new pg.Client({ connectionString: env['TEST_DB_URL'] });
await db.connect();
const cookies = new Map<string, string>();
async function call(
  label: string,
  method: 'GET' | 'POST',
  url: string,
  payload?: object,
) {
  const r = await app.inject({
    method,
    url,
    headers: {
      origin: config!.webOrigin,
      ...(cookies.has(label) ? { cookie: cookies.get(label)! } : {}),
    },
    ...(payload ? { payload } : {}),
    remoteAddress: `127.0.0.${label === 'ADMIN' ? 151 : label === 'MEMBER' ? 152 : 153}`,
  });
  for (const c of r.cookies)
    if (c.name === 'yapesa_session') cookies.set(label, `${c.name}=${c.value}`);
  return r;
}
async function ok(label: string, url: string, payload: object) {
  const r = await call(label, 'POST', url, payload);
  assert.equal(r.statusCode, 200, `${url}: ${r.body}`);
  return r.json();
}
async function rpc(name: string, input: object, token: string) {
  return fetch(`${config!.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config!.publishableKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}
test('real staff invitation requires live administrator and phone, PIN and TOTP before any group authority', async () => {
  const org = env['TEST_ORG_A']!,
    phone = '+256700000023';
  assert.equal((await call('NONE', 'GET', '/api/admin/staff')).statusCode, 401);
  await ok('MEMBER', '/api/auth/login', {
    phone: env['TEST_MEMBER_PHONE'],
    pin: env['TEST_PIN'],
  });
  assert.equal(
    (await call('MEMBER', 'GET', '/api/admin/staff')).statusCode,
    403,
  );
  await ok('ADMIN', '/api/auth/login', {
    phone: env['TEST_ADMIN_PHONE'],
    pin: env['TEST_PIN'],
  });
  assert.equal(
    (await call('ADMIN', 'GET', '/api/admin/staff')).statusCode,
    403,
  );
  await ok('ADMIN', '/api/auth/mfa/verify', {
    factor_id: env['TEST_ADMIN_FACTOR'],
    code: totp(env['TEST_ADMIN_TOTP']!),
  });
  const input = {
    request_id: v7(),
    organisation_id: org,
    person_id: null,
    name: 'Local invited officer',
    phone,
    email: 'local-invited-officer@example.invalid',
    role: 'treasurer',
    reason: 'Local staff onboarding acceptance test',
  };
  const invalid = await call('ADMIN', 'POST', '/api/admin/staff/invitations', {
    ...input,
    name: '',
  });
  assert.equal(invalid.statusCode, 422);
  assert.equal(invalid.json().error, 'INVALID_STAFF_INVITATION');
  const invitation = await ok('ADMIN', '/api/admin/staff/invitations', input);
  assert.equal(
    (await ok('ADMIN', '/api/admin/staff/invitations', input)).id,
    invitation.id,
  );
  assert.equal(
    (
      await call('ADMIN', 'POST', '/api/admin/staff/invitations', {
        ...input,
        role: 'chair',
      })
    ).statusCode,
    409,
  );
  const created = await db.query(
    'select p.id,p.auth_user_id,u.phone_confirmed_at,u.email_confirmed_at,u.raw_app_meta_data from public.person p join auth.users u on u.id=p.auth_user_id where p.phone=$1',
    [phone],
  );
  assert.equal(created.rowCount, 1);
  const person = created.rows[0]!;
  assert.equal(person.phone_confirmed_at, null);
  assert.equal(person.email_confirmed_at, null);
  assert.equal(person.raw_app_meta_data.yapesa_activation, 'pending');
  assert.equal(
    (
      await db.query('select * from public.membership where person_id=$1', [
        person.id,
      ])
    ).rowCount,
    0,
  );
  const adminToken = openTokens(
    cookies.get('ADMIN')!.split('=')[1]!,
    config!.cookieKey,
  ).access_token;
  assert.equal(
    (
      await rpc(
        'staff_job',
        {
          p_invitation: invitation.id,
          p_phase: 'invite',
          p_finish: false,
          p_auth: null,
        },
        adminToken,
      )
    ).status,
    200,
  ); // Completed result can be read safely.
  const accepted = await ok('NEW', '/api/auth/invitation/accept', {
    phone,
    code: env['TEST_RECOVERY_CODE'],
    pin: env['TEST_PIN'],
  });
  assert.equal(accepted.user.requires_mfa, true);
  assert.equal(accepted.user.mfa_verified, false);
  assert.equal((await call('NEW', 'GET', '/api/groups')).statusCode, 403);
  assert.equal(
    (await call('NEW', 'POST', '/api/auth/invitation/finish', {})).statusCode,
    403,
  );
  const factor = await ok('NEW', '/api/auth/mfa/enroll', {});
  assert.match(factor.uri, /otpauth:/);
  const verified = await ok('NEW', '/api/auth/mfa/verify', {
    factor_id: factor.id,
    code: totp(factor.secret),
  });
  assert.equal(verified.user.mfa_verified, true);
  assert(!verified.user.activation_pending);
  const memberships = await db.query(
    'select role,organisation_id from public.membership where person_id=$1',
    [person.id],
  );
  assert.deepEqual(memberships.rows, [
    { role: 'treasurer', organisation_id: org },
  ]);
  assert.equal(
    (
      await db.query(
        "select raw_app_meta_data->>'yapesa_activation' state from auth.users where id=$1",
        [person.auth_user_id],
      )
    ).rows[0]!.state,
    'active',
  );
  await ok('NEW', '/api/auth/invitation/finish', {});
  assert.equal(
    (
      await db.query('select * from public.membership where person_id=$1', [
        person.id,
      ])
    ).rowCount,
    1,
  );
  const groups = await call('NEW', 'GET', '/api/groups');
  assert.equal(groups.statusCode, 200);
  assert.deepEqual(
    groups.json().map((g: { id: string }) => g.id),
    [org],
  );
  const token = openTokens(
    cookies.get('NEW')!.split('=')[1]!,
    config!.cookieKey,
  ).access_token;
  assert.equal(
    (
      await rpc(
        'staff_job_context',
        { p_invitation: invitation.id, p_phase: 'invite' },
        token,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await rpc(
        'staff_invite',
        {
          p_request: v7(),
          p_org: org,
          p_phone: '+256700000024',
          p_name: 'Denied',
          p_email: 'denied@example.invalid',
          p_role: 'chair',
          p_reason: 'Denied',
        },
        token,
      )
    ).status,
    403,
  );
  const permissions = await db.query(
    "select has_table_privilege('authenticated','private.staff_invitation','INSERT') direct,has_table_privilege('yapesa_identity','public.journal','INSERT') money",
  );
  assert.deepEqual(permissions.rows, [{ direct: false, money: false }]);
  assert.equal(
    (
      await db.query(
        "select count(*)::text count from private.identity_event where invitation_id=$1 and phase='activate_finished'",
        [invitation.id],
      )
    ).rows[0]!.count,
    '1',
  );
});
test.after(async () => {
  globalThis.fetch = originalFetch;
  await app.close();
  await db.end();
});
