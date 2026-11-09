import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { v7 } from 'uuid';
import { buildApp } from '../apps/api/src/app.js';
import { readConfig } from '../apps/api/src/config.js';
import { openTokens } from '../apps/api/src/security.js';
import { sealFineract } from '../apps/api/src/sacco-credentials.js';
import { totp } from '../scripts/totp.js';
const config = readConfig();
assert(config);
for (const url of [config.supabaseUrl, process.env['TEST_DB_URL']!])
  assert(
    ['localhost', '127.0.0.1'].includes(new URL(url).hostname),
    'Disposable SACCO metadata fixtures only',
  );
config.fineractInstances = {
  local_sacco: {
    url: 'https://127.0.0.1:8443/fineract-provider/api/v1/',
    localTest: true,
  },
};
const app = buildApp(config),
  db = new pg.Client({ connectionString: process.env['TEST_DB_URL'] }),
  cookies = new Map<string, string>();
await db.connect();
const admin = 'MEETING_ADMIN',
  teller = 'MEETING_SECRETARY',
  manager = 'MEETING_TREASURER',
  foreign = 'MEETING_CHAIR',
  member = 'MEETING_MEMBER',
  device = v7();
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
    remoteAddress: `127.0.1.${[admin, teller, manager, foreign, member, 'NONE', 'AAL1'].indexOf(label) + 150}`,
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
async function login(label: string, mfa = true, source = label) {
  await ok(label, '/api/auth/login', {
    phone: process.env[`TEST_${source}_PHONE`],
    pin: process.env['TEST_PIN'],
  });
  if (mfa)
    await ok(label, '/api/auth/mfa/verify', {
      factor_id: process.env[`TEST_${source}_FACTOR`],
      code: totp(process.env[`TEST_${source}_TOTP`]!),
    });
}
function command(extra: object) {
  return {
    request_id: v7(),
    device_id: device,
    reason: 'Disposable SACCO boundary acceptance',
    ...extra,
  };
}
function token(label: string) {
  return openTokens(cookies.get(label)!.split('=')[1]!, config!.cookieKey)
    .access_token;
}
async function rpc(name: string, args: object, label: string, gateway = true) {
  const r = await fetch(`${config!.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config!.publishableKey,
      Authorization: `Bearer ${token(label)}`,
      'Content-Type': 'application/json',
      ...(gateway ? { 'x-yapesa-auth': config!.gatewayKey } : {}),
    },
    body: JSON.stringify(args),
  });
  const body: unknown = await r.json();
  return { status: r.status, body };
}
test('SACCO metadata requires verified scoped staff and a server gateway; it never grants Groups money authority', async () => {
  assert.equal((await call('NONE', 'GET', '/api/saccos')).statusCode, 401);
  for (const label of [admin, teller, manager, foreign]) await login(label);
  await login(member, false);
  assert.deepEqual((await call(member, 'GET', '/api/saccos')).json(), []);
  await login('AAL1', false, teller);
  assert.equal((await call('AAL1', 'GET', '/api/saccos')).statusCode, 403);
  assert.equal(
    (
      await call(
        teller,
        'POST',
        '/api/admin/saccos',
        command({
          action: 'create',
          name: 'Forbidden',
          instance: 'local_sacco',
          tenant: 'default',
        }),
      )
    ).statusCode,
    403,
  );
  const create = command({
    action: 'create',
    name: 'Local SACCO acceptance',
    country: 'UG',
    currency: 'UGX',
    zone: 'Africa/Kampala',
    instance: 'local_sacco',
    tenant: 'default',
  });
  const created = await ok(admin, '/api/admin/saccos', create),
    org = created.id;
  assert.deepEqual(await ok(admin, '/api/admin/saccos', create), created);
  assert.equal(
    (
      await call(admin, 'POST', '/api/admin/saccos', {
        ...create,
        name: 'Changed replay',
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await call(admin, 'GET', `/api/saccos/${org}`)).statusCode,
    403,
    'Platform oversight does not implicitly become engine staff',
  );
  const people = (
    await db.query('select id,phone from public.person where phone=any($1)', [
      [
        process.env[`TEST_${teller}_PHONE`],
        process.env[`TEST_${manager}_PHONE`],
      ],
    ])
  ).rows as { id: string; phone: string }[];
  const tellerPerson = people.find(
      (p) => p.phone === process.env[`TEST_${teller}_PHONE`],
    )!.id,
    managerPerson = people.find(
      (p) => p.phone === process.env[`TEST_${manager}_PHONE`],
    )!.id;
  for (const [person, role] of [
    [tellerPerson, 'teller'],
    [managerPerson, 'manager'],
  ])
    await ok(
      admin,
      '/api/admin/saccos',
      command({ action: 'role', org, person, role, enabled: true }),
    );
  const list = await call(teller, 'GET', '/api/saccos');
  assert.equal(list.statusCode, 200);
  assert.equal(list.headers['cache-control'], 'no-store');
  assert(list.json().some((o: { id: string }) => o.id === org));
  assert(
    !(await call(foreign, 'GET', '/api/saccos'))
      .json()
      .some((o: { id: string }) => o.id === org),
  );
  assert.equal(
    (await call(foreign, 'GET', `/api/saccos/${org}`)).statusCode,
    403,
  );
  assert.equal(
    (await call(teller, 'GET', `/api/saccos/${org}`)).json().linked,
    false,
  );
  assert.equal(
    (await rpc('sacco_context', { p_org: org }, teller, false)).status,
    403,
    'Direct client RPC cannot retrieve credential envelopes',
  );
  const c = await rpc('sacco_context', { p_org: org }, teller);
  assert.equal(c.status, 200);
  const context = c.body as { version: string };
  await ok(admin, `/api/admin/saccos/${org}/identities`, {
    request_id: v7(),
    device_id: device,
    person: tellerPerson,
    user: '90001',
    username: 'local_individual_teller',
    reason: 'Disposable assigned individual identity',
  });
  const duplicate = await call(
    admin,
    'POST',
    `/api/admin/saccos/${org}/identities`,
    {
      request_id: v7(),
      device_id: device,
      person: managerPerson,
      user: '90001',
      username: 'different_person',
      reason: 'Disposable shared-account denial',
    },
  );
  assert.equal(duplicate.statusCode, 409);
  await ok(admin, `/api/admin/saccos/${org}/identities`, {
    request_id: v7(),
    device_id: device,
    person: managerPerson,
    user: '90002',
    username: 'local_individual_manager',
    reason: 'Disposable assigned independent identity',
  });
  const credential = sealFineract(
    {
      username: 'local_individual_teller',
      password: 'fixture-only-not-a-hosted-credential',
    },
    config!.cookieKey,
    tellerPerson,
    org,
    context.version,
    '90001',
  );
  assert.equal(
    (
      await rpc(
        'sacco_link',
        {
          p_org: org,
          p_user: '90001',
          p_username: 'local_individual_teller',
          p_credential: credential,
          p_version: context.version,
          p_device: device,
        },
        teller,
      )
    ).status,
    200,
  );
  const visible = await call(teller, 'GET', `/api/saccos/${org}`);
  assert.equal(visible.statusCode, 200);
  assert.equal(visible.json().linked, true);
  assert(!visible.body.includes(credential));
  assert(!visible.body.includes('fixture-only'));
  const managerContext = (await rpc('sacco_context', { p_org: org }, manager))
    .body as { link: unknown };
  assert.equal(
    managerContext.link,
    null,
    'A manager cannot retrieve another staff member’s credentials',
  );
  const denied = await rpc(
    'sacco_link',
    {
      p_org: org,
      p_user: '90001',
      p_username: 'different_person',
      p_credential: credential,
      p_version: context.version,
      p_device: device,
    },
    manager,
  );
  assert.equal(
    denied.status,
    403,
    'One Fineract app user cannot represent two Yapesa people',
  );
  const request = v7(),
    args = {
      p_org: org,
      p_request: request,
      p_operation: 'savings.deposit',
      p_hash: 'a'.repeat(64),
      p_user: '90001',
    };
  assert.equal((await rpc('sacco_prepare', args, teller)).status, 200);
  assert.equal(
    (await rpc('sacco_prepare', { ...args, p_hash: 'b'.repeat(64) }, teller))
      .status,
    409,
  );
  assert.equal((await rpc('sacco_prepare', args, manager)).status, 403);
  assert.equal(
    (
      await rpc(
        'sacco_finish',
        {
          p_org: org,
          p_request: request,
          p_status: 'uncertain',
          p_result: { error: 'DISPOSABLE_UNCERTAIN_OUTCOME' },
        },
        teller,
      )
    ).status,
    200,
  );
  assert.equal(
    ((await rpc('sacco_prepare', args, teller)).body as { status: string })
      .status,
    'uncertain',
  );
  assert.equal(
    (
      await rpc(
        'sacco_finish',
        {
          p_org: org,
          p_request: request,
          p_status: 'succeeded',
          p_result: { resource_id: '42', status: 'recorded' },
        },
        teller,
      )
    ).status,
    200,
  );
  assert.equal(
    ((await rpc('sacco_prepare', args, teller)).body as { status: string })
      .status,
    'succeeded',
  );
  const permissions = (
    await db.query(
      "select has_table_privilege('authenticated','private.fineract_link','SELECT') client_secret_read,has_table_privilege('yapesa_sacco','public.journal','INSERT') group_journal_write,has_table_privilege('yapesa_sacco','public.journal','SELECT') group_journal_read,has_function_privilege('anon','public.sacco_context(uuid)','EXECUTE') anonymous_context",
    )
  ).rows[0];
  assert.deepEqual(permissions, {
    client_secret_read: false,
    group_journal_write: false,
    group_journal_read: false,
    anonymous_context: false,
  });
  await assert.rejects(
    () =>
      db.query(
        'update private.fineract_command set operation=operation where request_id=$1',
        [request],
      ),
    (error: unknown) => (error as { code: string }).code === '55000',
  );
  await ok(teller, `/api/saccos/${org}/disconnect`, { device_id: device });
  await ok(
    admin,
    '/api/admin/saccos',
    command({
      action: 'role',
      org,
      person: tellerPerson,
      role: 'teller',
      enabled: false,
    }),
  );
  assert.equal(
    (await call(teller, 'GET', `/api/saccos/${org}`)).statusCode,
    403,
  );
  assert.equal(
    (await rpc('sacco_prepare', args, teller)).status,
    403,
    'Revoked access blocks even prior receipts',
  );
  assert.equal(
    (
      await db.query(
        'select count(*)::text count from public.journal where organisation_id=$1',
        [org],
      )
    ).rows[0].count,
    '0',
  );
});
test.after(async () => {
  await app.close();
  await db.end();
});
