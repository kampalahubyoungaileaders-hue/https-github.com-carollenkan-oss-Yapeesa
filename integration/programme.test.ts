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
    'Disposable programme fixtures only',
  );
// Only disposable local RPC errors are logged, never Auth bodies or credentials.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await originalFetch(input, init),
    url = new URL(String(input));
  if (
    !response.ok &&
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
    /\/rest\/v1\/rpc\/(admin_|programme_report|staff_)/.test(url.pathname)
  ) {
    const e = (await response.clone().json()) as {
      code?: string;
      message?: string;
    };
    console.error(
      'Local programme RPC diagnostic',
      url.pathname,
      e.code,
      e.message,
    );
  }
  return response;
};
const app = buildApp(config),
  db = new pg.Client({ connectionString: env['TEST_DB_URL'] });
await db.connect();
const org = env['TEST_MEETING_ORG_PROGRAMME_INTEGRATION']!,
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
    remoteAddress: `127.0.0.${[sec, treas, chair, member, admin, 'PROGRAMME', 'PROGRAMME_OTHER', 'AAL1', 'NONE'].indexOf(label) + 181}`,
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
const today = new Date().toISOString().slice(0, 10);
function shifted(days: number) {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function command(action: string, extra: object = {}) {
  return {
    request_id: v7(),
    device_id: device,
    action,
    programme_id: null,
    group_id: null,
    person_id: null,
    enabled: null,
    name: '',
    country_code: '',
    currency: '',
    time_zone: '',
    reason: 'Disposable programme acceptance',
    ...extra,
  };
}
async function pc(action: string, extra: object = {}) {
  return ok('/api/admin/programmes', command(action, extra), admin);
}
async function login(label: string, mfa = true, credentials = label) {
  await ok(
    '/api/auth/login',
    { phone: env[`TEST_${credentials}_PHONE`], pin: env['TEST_PIN'] },
    label,
  );
  if (mfa)
    await ok(
      '/api/auth/mfa/verify',
      {
        factor_id: env[`TEST_${credentials}_FACTOR`],
        code: totp(env[`TEST_${credentials}_TOTP`]!),
      },
      label,
    );
}
async function post(url: string, body: object, label = sec) {
  return ok(url, body, label);
}
function mc(action: string, extra: object = {}) {
  return {
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
  };
}
function lc(action: string, extra: object = {}) {
  return {
    request_id: v7(),
    device_id: device,
    action,
    meeting_id: null,
    member_id: null,
    target_id: null,
    policy_id: null,
    months: null,
    amount: null,
    reason: 'Disposable programme loan',
    ...extra,
  };
}
async function report(id: string, label = 'PROGRAMME', date = today) {
  const r = await call(label, 'GET', `/api/programmes/${id}?as_of=${date}`);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.headers['cache-control'], 'no-store');
  return r.json();
}
test('programme officers see scoped group aggregates, exact arrears and trends without acquiring member or money access', async () => {
  assert.equal((await call('NONE', 'GET', '/api/programmes')).statusCode, 401);
  for (const label of [admin, sec, treas, 'PROGRAMME', 'PROGRAMME_OTHER'])
    await login(label);
  await login(member, false);
  const created = command('create', {
    name: 'Local acceptance programme',
    country_code: 'UG',
    currency: 'UGX',
    time_zone: 'Africa/Kampala',
  });
  const programme = (await ok('/api/admin/programmes', created, admin)).id;
  assert.equal(
    (await ok('/api/admin/programmes', created, admin)).id,
    programme,
    'Create retry retains its original receipt',
  );
  const other = (
    await pc('create', {
      name: 'Local other programme',
      country_code: 'UG',
      currency: 'UGX',
      time_zone: 'Africa/Kampala',
    })
  ).id;
  await db.query(
    "insert into public.currency_reference(code,minor_digits) values('KES',2) on conflict do nothing",
  );
  const kes = (
    await post(
      '/api/admin/groups',
      {
        request_id: v7(),
        device_id: device,
        name: 'Local KES programme group',
        country_code: 'KE',
        currency: 'KES',
        time_zone: 'Africa/Nairobi',
        max_shares: '5',
        starts_on: shifted(-365),
        ends_on: shifted(365),
        share_price: '5000',
      },
      admin,
    )
  ).id;
  for (const group of [org, env['TEST_MEETING_ORG_PROGRAMME_STALE'], kes]) {
    const body = command('link_group', {
      programme_id: programme,
      group_id: group,
      enabled: true,
    });
    assert.equal((await ok('/api/admin/programmes', body, admin)).id, group);
    assert.equal(
      (await ok('/api/admin/programmes', body, admin)).id,
      group,
      'Link retry must not conflict with the saved audit state',
    );
  }
  await pc('link_group', {
    programme_id: other,
    group_id: env['TEST_MEETING_ORG_PROGRAMME_FOREIGN'],
    enabled: true,
  });
  await pc('officer', {
    programme_id: programme,
    person_id: env['TEST_PROGRAMME_PERSON'],
    enabled: true,
  });
  await pc('officer', {
    programme_id: other,
    person_id: env['TEST_PROGRAMME_OTHER_PERSON'],
    enabled: true,
  });
  assert.equal(
    (
      await call(
        sec,
        'POST',
        '/api/admin/programmes',
        command('create', {
          name: 'Forbidden',
          country_code: 'UG',
          currency: 'UGX',
          time_zone: 'Africa/Kampala',
        }),
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await call(member, 'GET', `/api/programmes/${programme}`)).statusCode,
    403,
  );
  await login('AAL1', false, 'PROGRAMME');
  assert.equal(
    (await call('AAL1', 'GET', `/api/programmes/${programme}`)).statusCode,
    403,
  );
  assert.deepEqual(
    (await call('PROGRAMME', 'GET', '/api/programmes'))
      .json()
      .map((p: { id: string }) => p.id),
    [programme],
  );
  assert.equal(
    (await call('PROGRAMME_OTHER', 'GET', `/api/programmes/${programme}`))
      .statusCode,
    403,
  );
  assert.equal(
    (await call('PROGRAMME', 'GET', `/api/programmes/${other}`)).statusCode,
    403,
  );
  assert.equal((await call('PROGRAMME', 'GET', root)).statusCode, 403);
  assert.equal(
    (
      await call(
        'PROGRAMME',
        'GET',
        `${root}/audit.pdf?from=2000-01-01&to=2099-12-31`,
      )
    ).statusCode,
    403,
  );
  assert.deepEqual(
    (await call('PROGRAMME', 'GET', '/api/groups')).json(),
    [],
    'Programme membership is not group membership',
  );
  await post(
    `/api/admin/groups/${org}/settings`,
    {
      request_id: v7(),
      device_id: device,
      name: 'Local programme lending group',
      max_shares: '5',
      starts_on: shifted(-365),
      ends_on: shifted(365),
      share_price: '5000',
    },
    admin,
  );
  const old = (
    await post(`${root}/meetings`, mc('open', { date: shifted(-120) }))
  ).id;
  await post(
    `${root}/meetings`,
    mc('attendance', {
      meeting_id: old,
      member_id: env['TEST_MEETING_SECRETARY_PERSON'],
      status: 'present',
    }),
  );
  await post(
    `${root}/meetings`,
    mc('attendance', {
      meeting_id: old,
      member_id: env['TEST_MEETING_MEMBER_PERSON'],
      status: 'absent',
    }),
  );
  await post(
    `${root}/meetings`,
    mc('attendance', {
      meeting_id: old,
      member_id: env['TEST_MEETING_MEMBER_PERSON'],
      status: 'present',
    }),
  );
  await post(`${root}/shares`, {
    client_id: v7(),
    device_id: device,
    member_id: env['TEST_MEETING_MEMBER_PERSON'],
    meeting_date: shifted(-120),
    shares: '5',
    client_amount: '25000',
    client_calc_version: 'groups-shares-v1',
    note: 'Disposable programme loan collateral',
  });
  await post(
    `/api/admin/groups/${org}/loans`,
    {
      request_id: v7(),
      device_id: device,
      policy: {
        monthly_rate_bps: '100',
        method: 'flat',
        multiple: '3',
        max_months: '3',
        rounding: 'half_up',
        allocation: 'interest_first',
        dates: 'original_day',
        roles: ['treasurer'],
        separate: true,
        approvals: '1',
      },
    },
    admin,
  );
  const quote = await post(`${root}/loans/quote`, {
    member_id: env['TEST_MEETING_MEMBER_PERSON'],
    meeting_id: old,
    principal: '10000',
    months: '2',
  });
  const request = (
    await post(
      `${root}/loans`,
      lc('request', {
        meeting_id: old,
        member_id: env['TEST_MEETING_MEMBER_PERSON'],
        amount: '10000',
        months: '2',
        policy_id: quote.policy_id,
      }),
    )
  ).id;
  await post(
    `${root}/loans`,
    lc('approve', { meeting_id: old, target_id: request, device_id: v7() }),
    treas,
  );
  const loan = (
    await post(
      `${root}/loans`,
      lc('disburse', { meeting_id: old, target_id: request }),
    )
  ).id;
  const closing = (
    await post(
      `${root}/meetings`,
      mc('propose', {
        meeting_id: old,
        counted_cash: '15000',
        explanation: '',
      }),
    )
  ).record_id;
  await post(
    `${root}/meetings`,
    mc('approve', { meeting_id: old, proposal_id: closing }),
  );
  await post(
    `${root}/meetings`,
    mc('approve', { meeting_id: old, proposal_id: closing, device_id: v7() }),
    treas,
  );
  const current = (await post(`${root}/meetings`, mc('open', { date: today })))
    .id;
  const repayment = (
    await post(
      `${root}/loans`,
      lc('repay', { meeting_id: current, target_id: loan, amount: '1000' }),
    )
  ).id;
  await post(`/api/groups/${env['TEST_MEETING_ORG_PROGRAMME_STALE']}/shares`, {
    client_id: v7(),
    device_id: v7(),
    member_id: env['TEST_MEETING_MEMBER_PERSON'],
    meeting_date: shifted(-22),
    shares: '1',
    client_amount: '5000',
    client_calc_version: 'groups-shares-v1',
    note: 'Disposable stale group evidence',
  });
  const before = (await db.query('select count(*)::text n from public.journal'))
    .rows[0].n;
  let data = await report(programme);
  assert.equal(data.groups.length, 3);
  const lending = data.groups.find((g: { id: string }) => g.id === org);
  assert.equal(lending.arrears, '9200');
  assert.equal(lending.outstanding_principal, '9100');
  assert.equal(lending.loans_in_arrears, '1');
  assert.equal(lending.repayment_attention, true);
  assert.equal(lending.meeting_attention, false);
  assert.equal(
    Object.values(lending.ageing).reduce(
      (sum: bigint, v) => sum + BigInt(String(v)),
      0n,
    ),
    9200n,
  );
  const oldMonth = lending.trends.find(
    (m: { month: string }) => m.month.slice(0, 7) === shifted(-120).slice(0, 7),
  );
  assert.equal(oldMonth.roster, '2');
  assert.equal(oldMonth.present, '2');
  assert.equal(
    oldMonth.absent,
    '0',
    'Latest attendance marks replace earlier marks',
  );
  assert.equal(lending.trends.at(-1).repayments, '1000');
  assert.equal(
    data.groups.filter(
      (g: { meeting_attention: boolean }) => g.meeting_attention,
    ).length,
    2,
  );
  assert.deepEqual(
    data.currencies.map((c: { currency: string; arrears: string }) => [
      c.currency,
      c.arrears,
    ]),
    [
      ['KES', '0'],
      ['UGX', '9200'],
    ],
  );
  assert.equal(
    (await db.query('select count(*)::text n from public.journal')).rows[0].n,
    before,
    'Reporting cannot write money',
  );
  assert(
    !JSON.stringify(data).includes(env['TEST_MEETING_MEMBER_PERSON']!),
    'Report contains no borrower/member identities',
  );
  await post(
    `${root}/loans`,
    lc('reverse', {
      meeting_id: current,
      target_id: repayment,
      reason: 'Disposable repayment correction',
    }),
  );
  data = await report(programme);
  assert.equal(
    data.groups.find((g: { id: string }) => g.id === org).arrears,
    '10200',
  );
  assert.equal(
    data.groups.find((g: { id: string }) => g.id === org).trends.at(-1)
      .repayments,
    '0',
  );
  const token = openTokens(
    cookies.get('PROGRAMME')!.slice('yapesa_session='.length),
    config!.cookieKey,
  ).access_token;
  const claims = JSON.parse(
    Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'),
  );
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify(claims),
    ]);
    await db.query('set local role authenticated');
    assert.equal(
      (
        await db.query(
          'select count(*)::text n from public.group_txn where organisation_id=$1',
          [org],
        )
      ).rows[0].n,
      '0',
      'Programme officers cannot read individual group transactions directly',
    );
  } finally {
    await db.query('rollback');
  }
  await pc('link_group', {
    programme_id: programme,
    group_id: org,
    enabled: false,
  });
  assert(
    !(await report(programme)).groups.some((g: { id: string }) => g.id === org),
    'Unlink removes aggregates immediately',
  );
  assert.equal(
    (
      await call('PROGRAMME', 'POST', `${root}/shares`, {
        client_id: v7(),
        device_id: v7(),
        member_id: env['TEST_MEETING_MEMBER_PERSON'],
        meeting_date: today,
        shares: '1',
        client_amount: '5000',
        client_calc_version: 'groups-shares-v1',
        note: 'Denied',
      })
    ).statusCode,
    403,
  );
  await pc('officer', {
    programme_id: programme,
    person_id: env['TEST_PROGRAMME_PERSON'],
    enabled: false,
  });
  assert.equal(
    (await call('PROGRAMME', 'GET', `/api/programmes/${programme}`)).statusCode,
    403,
    'Existing verified session loses revoked programme scope',
  );
  const invitedPhone = '+256700000072';
  const inviteInput = {
    request_id: v7(),
    organisation_id: programme,
    person_id: null,
    name: 'Local invited programme officer',
    phone: invitedPhone,
    email: 'local-programme-invite@example.invalid',
    role: 'programme_officer',
    reason: 'Disposable programme activation proof',
  };
  assert.equal(
    (
      await call(admin, 'POST', '/api/admin/staff/invitations', {
        ...inviteInput,
        organisation_id: org,
      })
    ).statusCode,
    422,
    'Programme officer cannot be invited into a group role',
  );
  const invite = await ok('/api/admin/staff/invitations', inviteInput, admin);
  assert.equal(
    (await ok('/api/admin/staff/invitations', inviteInput, admin)).id,
    invite.id,
  );
  const person = (
    await db.query('select id from public.person where phone=$1', [
      invitedPhone,
    ])
  ).rows[0].id;
  assert.equal(
    (
      await db.query(
        'select count(*)::text n from public.membership where person_id=$1',
        [person],
      )
    ).rows[0].n,
    '0',
  );
  await ok(
    '/api/auth/invitation/accept',
    {
      phone: invitedPhone,
      code: env['TEST_RECOVERY_CODE'],
      pin: env['TEST_PIN'],
    },
    'NEW',
  );
  assert.equal(
    (await call('NEW', 'GET', `/api/programmes/${programme}`)).statusCode,
    403,
  );
  const factor = await ok('/api/auth/mfa/enroll', {}, 'NEW');
  await ok(
    '/api/auth/mfa/verify',
    { factor_id: factor.id, code: totp(factor.secret) },
    'NEW',
  );
  assert.deepEqual(
    (
      await db.query(
        'select role,organisation_id from public.membership where person_id=$1',
        [person],
      )
    ).rows,
    [{ role: 'programme_officer', organisation_id: programme }],
  );
  assert.equal((await report(programme, 'NEW')).id, programme);
  assert.deepEqual((await call('NEW', 'GET', '/api/groups')).json(), []);
  const grants = (
    await db.query(
      "select has_table_privilege('yapesa_programmes','public.journal','INSERT') journal_write,has_table_privilege('yapesa_programmes','public.person','SELECT') member_read,has_function_privilege('authenticated','private.programme_groups()','EXECUTE') scope_helper",
    )
  ).rows[0];
  assert.deepEqual(grants, {
    journal_write: false,
    member_read: false,
    scope_helper: false,
  });
});
test.after(async () => {
  await app.close();
  await db.end();
});
