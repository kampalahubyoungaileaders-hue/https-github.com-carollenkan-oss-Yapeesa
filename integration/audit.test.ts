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
    'Disposable audit fixtures only',
  );
const app = buildApp(config),
  db = new pg.Client({ connectionString: env['TEST_DB_URL'] });
await db.connect();
const org = env['TEST_MEETING_ORG_AUDIT_INTEGRATION']!,
  root = `/api/groups/${org}`,
  device = v7(),
  cookies = new Map<string, string>();
const sec = 'MEETING_SECRETARY',
  treas = 'MEETING_TREASURER',
  chair = 'MEETING_CHAIR',
  member = 'MEETING_MEMBER',
  admin = 'MEETING_ADMIN';
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
    remoteAddress: `127.0.0.${[sec, treas, chair, member, admin].indexOf(label) + 121}`,
  });
  for (const c of r.cookies)
    if (c.name === 'yapesa_session') cookies.set(label, `${c.name}=${c.value}`);
  return r;
}
async function ok(url: string, payload: object, label = sec) {
  const r = await call(label, 'POST', url, payload);
  assert.equal(r.statusCode, 200, `${url}: ${r.body}`);
  return r.json();
}
test('audit exports preserve original and reversing evidence with verified scoped access', async () => {
  const pdf = `${root}/audit.pdf?from=2000-01-01&to=2099-12-31`;
  assert.equal((await call('NONE', 'GET', pdf)).statusCode, 401);
  for (const label of [sec, member, admin]) {
    await ok(
      '/api/auth/login',
      { phone: env[`TEST_${label}_PHONE`], pin: env['TEST_PIN'] },
      label,
    );
    assert.equal((await call(label, 'GET', pdf)).statusCode, 403);
    if (label !== member)
      await ok(
        '/api/auth/mfa/verify',
        {
          factor_id: env[`TEST_${label}_FACTOR`],
          code: totp(env[`TEST_${label}_TOTP`]!),
        },
        label,
      );
  }
  const saved = await ok(`${root}/shares`, {
    member_id: env['TEST_MEETING_MEMBER_PERSON'],
    meeting_date: new Date().toISOString().slice(0, 10),
    shares: '1',
    client_id: v7(),
    device_id: device,
    client_amount: '9007199254740993',
    client_calc_version: 'groups-shares-v1',
    note: 'Disposable audit evidence',
  });
  const transaction = saved.transaction_id ?? saved.id;
  assert(transaction, 'Share receipt must identify its immutable transaction');
  await ok(`${root}/reversals`, {
    transaction_id: transaction,
    client_id: v7(),
    device_id: device,
    reason: 'Disposable audit reversal',
  });
  const before = (await db.query('select count(*)::text n from public.journal'))
    .rows[0].n;
  const token = openTokens(
    cookies.get(sec)!.slice('yapesa_session='.length),
    config!.cookieKey,
  ).access_token;
  const raw = await fetch(
    `${config!.supabaseUrl}/rest/v1/rpc/group_audit_extract`,
    {
      method: 'POST',
      headers: {
        apikey: config!.publishableKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_org: org,
        p_from: '2000-01-01',
        p_to: '2099-12-31',
        p_record: transaction,
      }),
    },
  );
  assert.equal(raw.status, 200);
  const data = await raw.json();
  assert.equal(data.group_id, org);
  assert(data.sources.length >= 2, 'Original and reversal remain linked');
  assert(
    JSON.stringify(data.sources).includes('9007199254740993'),
    'Original client amount retains exact digits',
  );
  assert(data.journals.length >= 2);
  for (const label of [sec, admin]) {
    const r = await call(label, 'GET', `${pdf}&reference=${transaction}`);
    assert.equal(r.statusCode, 200, r.body.slice(0, 200));
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.rawPayload.subarray(0, 5).toString(), '%PDF-');
  }
  assert.equal(
    (
      await call(
        sec,
        'GET',
        `/api/groups/${env['TEST_ORG_B']}/audit.pdf?from=2000-01-01&to=2099-12-31`,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await call(sec, 'GET', `${root}/audit.pdf?from=2026-12-31&to=2026-01-01`))
      .statusCode,
    422,
  );
  assert.equal(
    (await db.query('select count(*)::text n from public.journal')).rows[0].n,
    before,
    'Export must not write money',
  );
  const privileges = (
    await db.query(
      "select has_table_privilege('yapesa_audit','public.journal','INSERT') money_write,has_function_privilege('authenticated','private.audit_sources(uuid)','EXECUTE') source_helper",
    )
  ).rows[0];
  assert.deepEqual(privileges, { money_write: false, source_helper: false });
});
test.after(async () => {
  await app.close();
  await db.end();
});
