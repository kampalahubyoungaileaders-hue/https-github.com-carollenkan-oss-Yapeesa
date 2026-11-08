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
    'Disposable MFA recovery only',
  );
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const r = await originalFetch(input, init);
  const url = new URL(String(input));
  if (!r.ok && url.pathname.startsWith('/rest/v1/rpc/mfa_')) {
    const e = (await r.clone().json()) as { code?: string; message?: string };
    console.error('Local MFA RPC diagnostic', url.pathname, e.code, e.message);
  }
  return r;
};
const app = buildApp(config),
  db = new pg.Client({ connectionString: env['TEST_DB_URL'] });
await db.connect();
const cookies = new Map<string, Map<string, string>>();
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
      ...(cookies.has(label)
        ? {
            cookie: [...cookies.get(label)!.entries()]
              .map(([k, v]) => `${k}=${v}`)
              .join('; '),
          }
        : {}),
    },
    ...(payload ? { payload } : {}),
    remoteAddress: `127.0.0.${['ADMIN', 'MEETING_ADMIN', 'LOST_ADMIN', 'RECOVERY', 'NONE', 'SECOND'].indexOf(label) + 161}`,
  });
  for (const c of r.cookies) {
    if (!cookies.has(label)) cookies.set(label, new Map());
    cookies.get(label)!.set(c.name, c.value);
  }
  return r;
}
async function ok(label: string, url: string, payload: object) {
  const r = await call(label, 'POST', url, payload);
  assert.equal(r.statusCode, 200, `${url}: ${r.body}`);
  return r.json();
}
async function login(label: string) {
  await ok(label, '/api/auth/login', {
    phone: env[`TEST_${label}_PHONE`],
    pin: env['TEST_PIN'],
  });
  await ok(label, '/api/auth/mfa/verify', {
    factor_id: env[`TEST_${label}_FACTOR`],
    code: totp(env[`TEST_${label}_TOTP`]!),
  });
}
test('two verified independent administrators reset lost factors; fresh SMS and a new TOTP unlock recovery without changing journals', async () => {
  const before = (
    await db.query('select count(*)::text count from public.journal')
  ).rows[0]!.count;
  assert.equal(
    (await call('NONE', 'GET', '/api/admin/authenticator-recovery')).statusCode,
    401,
  );
  const phone = env['TEST_LOST_ADMIN_PHONE']!;
  await ok('RECOVERY', '/api/auth/recovery/verify', {
    phone,
    code: env['TEST_RECOVERY_CODE'],
  });
  const body = {
    request_id: v7(),
    reason: 'Lost authenticator on a replaced test device',
  };
  const saved = await ok(
    'RECOVERY',
    '/api/auth/recovery/lost-authenticator',
    body,
  );
  const resumed = await ok(
    'RECOVERY',
    '/api/auth/recovery/lost-authenticator',
    {
      request_id: v7(),
      reason: 'Resume the existing recovery from another browser visit',
    },
  );
  assert.equal(resumed.id, saved.id);
  assert.equal(
    (await ok('RECOVERY', '/api/auth/recovery/lost-authenticator', body)).id,
    saved.id,
  );
  assert.equal(
    (
      await call('RECOVERY', 'POST', '/api/auth/recovery/complete', {
        pin: '843291',
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call('RECOVERY', 'POST', '/api/auth/recovery/enroll', {}))
      .statusCode,
    403,
  );
  assert.equal((await call('RECOVERY', 'GET', '/api/groups')).statusCode, 401); // Recovery cookie cannot become a login cookie.
  for (const actor of ['ADMIN', 'MEETING_ADMIN', 'LOST_ADMIN'])
    await login(actor);
  const endpoint = `/api/admin/authenticator-recovery/${saved.id}`;
  const approval = (evidence: string) => ({
    request_id: v7(),
    evidence,
    identity_verified: true,
  });
  assert.equal(
    (
      await call(
        'LOST_ADMIN',
        'POST',
        `${endpoint}/approve`,
        approval('Attempted own identity verification'),
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call('ADMIN', 'POST', `${endpoint}/approve`, {
        ...approval('Unverified identity'),
        identity_verified: false,
      })
    ).statusCode,
    403,
  );
  const first = approval(
    'Verified the person against the original staff identity record and independent callback',
  );
  await ok('ADMIN', `${endpoint}/approve`, first);
  await ok('ADMIN', `${endpoint}/approve`, first);
  assert.equal(
    (await call('ADMIN', 'POST', `${endpoint}/reset`, {})).statusCode,
    403,
  );
  assert.equal(
    (
      await db.query(
        'select * from private.mfa_recovery_event where recovery_id=$1',
        [saved.id],
      )
    ).rowCount,
    0,
    'Failed preparation rolls back the lock event',
  );
  await ok(
    'MEETING_ADMIN',
    `${endpoint}/approve`,
    approval(
      'Independently verified the original staff identity and phone holder',
    ),
  );
  // Removing an approver stops their approval from counting immediately.
  await db.query(
    "update public.membership set ends_at=now() where person_id=$1 and role='fencher_admin'",
    [env['TEST_MEETING_ADMIN_PERSON']],
  );
  assert.equal(
    (await call('ADMIN', 'POST', `${endpoint}/reset`, {})).statusCode,
    403,
  );
  await db.query(
    "update public.membership set ends_at=null where person_id=$1 and role='fencher_admin'",
    [env['TEST_MEETING_ADMIN_PERSON']],
  );
  const oldToken = openTokens(
    cookies.get('LOST_ADMIN')!.get('yapesa_session')!,
    config!.cookieKey,
  ).access_token;
  await ok('ADMIN', `${endpoint}/reset`, {});
  await ok('ADMIN', `${endpoint}/reset`, {});
  assert.equal(
    (
      await db.query(
        'select * from auth.mfa_factors where user_id=(select auth_user_id from public.person where id=$1)',
        [env['TEST_LOST_ADMIN_PERSON']],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (await call('LOST_ADMIN', 'GET', '/api/admin/authenticator-recovery'))
      .statusCode,
    403,
  );
  const direct = await fetch(
    `${config!.supabaseUrl}/rest/v1/rpc/mfa_recovery_workspace`,
    {
      method: 'POST',
      headers: {
        apikey: config!.publishableKey,
        Authorization: `Bearer ${oldToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
  );
  assert.equal(direct.status, 403);
  // Old recovery sessions cannot pass the fresh-session recovery gate.
  assert(
    (await call('RECOVERY', 'POST', '/api/auth/recovery/enroll', {}))
      .statusCode >= 400,
  );
  const fresh = await ok('RECOVERY', '/api/auth/recovery/verify', {
    phone,
    code: env['TEST_RECOVERY_CODE'],
  });
  assert.equal(fresh.enrollment_allowed, true);
  assert.equal(fresh.mfa_verified, false);
  assert.equal(
    (
      await call('RECOVERY', 'POST', '/api/auth/recovery/complete', {
        pin: '843291',
      })
    ).statusCode,
    403,
  );
  const factor = await ok('RECOVERY', '/api/auth/recovery/enroll', {});
  const proof = await ok('RECOVERY', '/api/auth/recovery/mfa', {
    factor_id: factor.id,
    code: totp(factor.secret),
  });
  assert.equal(proof.mfa_verified, true);
  const result = await ok('RECOVERY', '/api/auth/recovery/complete', {
    pin: '843291',
  });
  assert.equal(result.cleanup_complete, true);
  await ok('LOST_ADMIN', '/api/auth/login', { phone, pin: '843291' });
  const verified = await ok('LOST_ADMIN', '/api/auth/mfa/verify', {
    factor_id: factor.id,
    code: totp(factor.secret),
  });
  assert.equal(verified.user.can_administer, true);
  const events = await db.query(
    'select phase from private.mfa_recovery_event where recovery_id=$1 order by recorded_at,phase',
    [saved.id],
  );
  assert.deepEqual(
    new Set(events.rows.map((x) => x.phase)),
    new Set(['prepared', 'reset', 'recovered']),
  );
  const permissions = (
    await db.query(
      "select has_table_privilege('authenticated','private.mfa_recovery','INSERT') direct,has_table_privilege('yapesa_recovery','auth.mfa_factors','DELETE') auth_write,has_table_privilege('yapesa_recovery','public.journal','INSERT') money",
    )
  ).rows[0];
  assert.deepEqual(permissions, {
    direct: false,
    auth_write: false,
    money: false,
  });
  assert.equal(
    (await db.query('select count(*)::text count from public.journal')).rows[0]!
      .count,
    before,
  );
});
test.after(async () => {
  globalThis.fetch = originalFetch;
  await app.close();
  await db.end();
});
