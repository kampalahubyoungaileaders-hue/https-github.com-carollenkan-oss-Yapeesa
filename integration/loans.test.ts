import test from 'node:test';
import fc from 'fast-check';
import { money, loanSchedule } from '@yapesa/domain';
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
    'Loan fixtures require a disposable local database',
  );
const app = buildApp(config);
const db = new pg.Client({ connectionString: env['TEST_DB_URL'] });
await db.connect();
const org = env['TEST_MEETING_ORG_LOANS_INTEGRATION']!;
const path = `/api/groups/${org}/loans`;
const meetingPath = `/api/groups/${org}/meetings`;
const device = v7();
const cookies = new Map<string, string>();
async function call(
  label: string,
  method: 'GET' | 'POST',
  url: string,
  payload?: object,
) {
  const response = await app.inject({
    method,
    url,
    headers: {
      origin: config!.webOrigin,
      ...(cookies.has(label) ? { cookie: cookies.get(label)! } : {}),
    },
    ...(payload ? { payload } : {}),
    remoteAddress: `127.0.0.${label === 'MEETING_SECRETARY' ? 81 : label === 'MEETING_TREASURER' ? 82 : label === 'MEETING_ADMIN' ? 83 : 84}`,
  });
  for (const c of response.cookies)
    if (c.name === 'yapesa_session') cookies.set(label, `${c.name}=${c.value}`);
  return response;
}
async function login(label: string, mfa = true) {
  let r = await call(label, 'POST', '/api/auth/login', {
    phone: env[`TEST_${label}_PHONE`],
    pin: env['TEST_PIN'],
  });
  assert.equal(r.statusCode, 200, r.body);
  if (mfa) {
    r = await call(label, 'POST', '/api/auth/mfa/verify', {
      factor_id: env[`TEST_${label}_FACTOR`],
      code: totp(env[`TEST_${label}_TOTP`]!),
    });
    assert.equal(r.statusCode, 200, r.body);
  }
}
function fine(action: string, extra: object = {}) {
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
    reason: 'Test loan record',
    ...extra,
  };
}
async function save(
  action: string,
  extra: object = {},
  label = 'MEETING_SECRETARY',
) {
  const r = await call(label, 'POST', path, fine(action, extra));
  assert.equal(r.statusCode, 200, r.body);
  return r.json() as { id: string };
}
function meeting(action: string, extra: object = {}) {
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
async function meet(
  action: string,
  extra: object = {},
  label = 'MEETING_SECRETARY',
) {
  const r = await call(label, 'POST', meetingPath, meeting(action, extra));
  assert.equal(r.statusCode, 200, r.body);
  return r.json() as { id: string };
}
async function ws(label = 'MEETING_SECRETARY') {
  const r = await call(label, 'GET', path);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function mark(id: string) {
  for (const member of [
    env['TEST_MEETING_SECRETARY_PERSON'],
    env['TEST_MEETING_MEMBER_PERSON'],
  ])
    await meet('attendance', {
      meeting_id: id,
      member_id: member,
      status: 'present',
    });
}
const terms = {
  monthly_rate_bps: '250',
  method: 'declining',
  multiple: '3',
  max_months: '3',
  rounding: 'half_up',
  allocation: 'interest_first',
  dates: 'original_day',
  roles: ['treasurer'],
  separate: true,
  approvals: '1',
};
async function policy(value: object | null = terms) {
  const b = { request_id: v7(), device_id: device, policy: value };
  const r = await call(
    'MEETING_ADMIN',
    'POST',
    `/api/admin/groups/${org}/loans`,
    b,
  );
  assert.equal(r.statusCode, 200, r.body);
  return b;
}
test('scheduled loans require group approvals, protect social cash, allocate partial repayments and reverse exactly', async () => {
  assert.equal((await call('NONE', 'GET', path)).statusCode, 401);
  for (const l of [
    'MEETING_SECRETARY',
    'MEETING_TREASURER',
    'MEETING_CHAIR',
    'MEETING_ADMIN',
    'B',
  ])
    await login(l);
  await login('MEETING_MEMBER', false);
  assert.equal((await call('B', 'GET', path)).statusCode, 403);
  const initial = await policy();
  assert.equal(
    (
      await call(
        'MEETING_ADMIN',
        'POST',
        `/api/admin/groups/${org}/loans`,
        initial,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        `/api/admin/groups/${org}/loans`,
        { ...initial, request_id: v7() },
      )
    ).statusCode,
    403,
  );
  const socialPolicy = await call(
    'MEETING_ADMIN',
    'POST',
    `/api/admin/groups/${org}/social`,
    {
      request_id: v7(),
      device_id: device,
      amount: '1000',
      roles: ['treasurer'],
      separate: true,
      require_all: false,
    },
  );
  assert.equal(socialPolicy.statusCode, 200, socialPolicy.body);
  const date = new Date().toISOString().slice(0, 10),
    member = env['TEST_MEETING_MEMBER_PERSON']!,
    secretary = env['TEST_MEETING_SECRETARY_PERSON']!;
  const meetingId = (await meet('open', { date })).id;
  await mark(meetingId);
  const social = await call(
    'MEETING_SECRETARY',
    'POST',
    `/api/groups/${org}/social`,
    {
      request_id: v7(),
      device_id: device,
      action: 'contribute',
      meeting_id: meetingId,
      member_id: member,
      amount: null,
      target_id: null,
      reason: '',
    },
  );
  assert.equal(social.statusCode, 200, social.body);
  let purchase = await call(
    'MEETING_SECRETARY',
    'POST',
    `/api/groups/${org}/shares`,
    {
      client_id: v7(),
      device_id: device,
      member_id: member,
      meeting_date: date,
      shares: '5',
      note: 'Loan security shares',
      client_amount: '25000',
      client_calc_version: 'groups-shares-v1',
    },
  );
  assert.equal(purchase.statusCode, 200, purchase.body);
  const quote = await call('MEETING_SECRETARY', 'POST', path + '/quote', {
    member_id: member,
    meeting_id: meetingId,
    principal: '20000',
    months: '3',
  });
  assert.equal(quote.statusCode, 200, quote.body);
  assert.equal(quote.json().borrowable, '75000');
  assert.equal(quote.json().available_cash, '25000');
  const create = fine('request', {
    meeting_id: meetingId,
    member_id: member,
    amount: '20000',
    months: '3',
    policy_id: quote.json().policy_id,
  });
  const requested = await call('MEETING_SECRETARY', 'POST', path, create);
  assert.equal(requested.statusCode, 200, requested.body);
  const request = requested.json().id;
  assert.equal(
    (await call('MEETING_SECRETARY', 'POST', path, create)).json().id,
    request,
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        path,
        fine('disburse', { meeting_id: meetingId, target_id: request }),
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        'MEETING_ADMIN',
        'POST',
        path,
        fine('approve', {
          meeting_id: meetingId,
          target_id: request,
          device_id: v7(),
          reason: '',
        }),
      )
    ).statusCode,
    403,
  );
  const collateralCorrection = await call(
    'MEETING_SECRETARY',
    'POST',
    `/api/groups/${org}/reversals`,
    {
      client_id: v7(),
      device_id: device,
      transaction_id: purchase.json().transaction_id,
      reason: 'Correcting the share record before loan approval',
    },
  );
  assert.equal(collateralCorrection.statusCode, 200, collateralCorrection.body);
  assert.equal(
    (
      await call(
        'MEETING_TREASURER',
        'POST',
        path,
        fine('approve', {
          meeting_id: meetingId,
          target_id: request,
          device_id: v7(),
          reason: '',
        }),
      )
    ).statusCode,
    422,
    'Approval rechecks the corrected share-backed limit',
  );
  purchase = await call(
    'MEETING_SECRETARY',
    'POST',
    `/api/groups/${org}/shares`,
    {
      client_id: v7(),
      device_id: device,
      member_id: member,
      meeting_date: date,
      shares: '5',
      note: 'Corrected loan security shares',
      client_amount: '25000',
      client_calc_version: 'groups-shares-v1',
    },
  );
  assert.equal(purchase.statusCode, 200, purchase.body);
  await db.query(
    "insert into public.membership(person_id,organisation_id,role) values($1,$2,'treasurer')",
    [secretary, org],
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        path,
        fine('approve', {
          meeting_id: meetingId,
          target_id: request,
          reason: '',
        }),
      )
    ).statusCode,
    403,
    'Separate approval excludes the request recorder even when eligible',
  );
  await db.query(
    "update public.membership set ends_at=now() where person_id=$1 and organisation_id=$2 and role='treasurer'",
    [secretary, org],
  );
  await save(
    'approve',
    { meeting_id: meetingId, target_id: request, device_id: v7(), reason: '' },
    'MEETING_TREASURER',
  );
  await db.query(
    "update public.membership set ends_at=now() where person_id=$1 and organisation_id=$2 and role='treasurer'",
    [env['TEST_MEETING_TREASURER_PERSON'], org],
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        path,
        fine('disburse', { meeting_id: meetingId, target_id: request }),
      )
    ).statusCode,
    422,
    'Expired approval roles do not count',
  );
  await db.query(
    "update public.membership set ends_at=null where person_id=$1 and organisation_id=$2 and role='treasurer'",
    [env['TEST_MEETING_TREASURER_PERSON'], org],
  );
  await policy({
    ...terms,
    monthly_rate_bps: '1000',
    allocation: 'principal_first',
    dates: 'month_end',
  });
  const loan = (
    await save('disburse', { meeting_id: meetingId, target_id: request })
  ).id;
  let data = await ws();
  assert.equal(data.loans[0].principal_remaining, '20000');
  assert.equal(data.loans[0].interest_remaining, '1000');
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        path,
        fine('repay', {
          meeting_id: meetingId,
          target_id: loan,
          amount: '21001',
        }),
      )
    ).statusCode,
    422,
  );
  const payment = fine('repay', {
    meeting_id: meetingId,
    target_id: loan,
    amount: '100',
  });
  const paid = await call('MEETING_SECRETARY', 'POST', path, payment);
  assert.equal(paid.statusCode, 200, paid.body);
  assert.deepEqual(
    (await call('MEETING_SECRETARY', 'POST', path, payment)).json(),
    paid.json(),
  );
  data = await ws();
  const posted = data.events.find(
    (e: { id: string }) => e.id === paid.json().id,
  );
  assert.equal(posted.principal, '0');
  assert.equal(posted.interest, '100');
  assert.equal(data.loans[0].interest_remaining, '900');
  const disbursement = data.events.find(
    (e: { kind: string }) => e.kind === 'disbursement',
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        path,
        fine('reverse', { meeting_id: meetingId, target_id: disbursement.id }),
      )
    ).statusCode,
    422,
  );
  await save('reverse', { meeting_id: meetingId, target_id: paid.json().id });
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        path,
        fine('reverse', { meeting_id: meetingId, target_id: paid.json().id }),
      )
    ).statusCode,
    409,
  );
  data = await ws();
  assert.equal(data.loans[0].interest_remaining, '1000');
  // Loan lending has left only 5,000 in the loan fund, plus 1,000 reserved social cash.
  const correction = await call(
    'MEETING_SECRETARY',
    'POST',
    `/api/groups/${org}/reversals`,
    {
      client_id: v7(),
      device_id: device,
      transaction_id: purchase.json().transaction_id,
      reason: 'Wrong share purchase',
    },
  );
  assert.equal(correction.statusCode, 422, correction.body);
  const quote2 = await call('MEETING_SECRETARY', 'POST', path + '/quote', {
    member_id: member,
    meeting_id: meetingId,
    principal: '5500',
    months: '3',
  });
  assert.equal(quote2.statusCode, 200, quote2.body);
  assert.equal(quote2.json().available_cash, '5000');
  const req2 = await save('request', {
    meeting_id: meetingId,
    member_id: member,
    amount: '5500',
    months: '3',
    policy_id: quote2.json().policy_id,
  });
  await save(
    'approve',
    { meeting_id: meetingId, target_id: req2.id, device_id: v7(), reason: '' },
    'MEETING_TREASURER',
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        path,
        fine('disburse', { meeting_id: meetingId, target_id: req2.id }),
      )
    ).statusCode,
    422,
    'Social cash cannot be lent',
  );
  await save('cancel', { meeting_id: meetingId, target_id: req2.id });
  const final = await save('repay', {
    meeting_id: meetingId,
    target_id: loan,
    amount: '21000',
  });
  data = await ws();
  assert.equal(data.loans[0].principal_remaining, '0');
  assert.equal(data.loans[0].interest_remaining, '0');
  const preview = await call(
    'MEETING_SECRETARY',
    'GET',
    `/api/groups/${org}/shareout-preview`,
  );
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().fund, '26000');
  assert.equal(preview.json().loans_outstanding, '0');
  const own = await ws('MEETING_MEMBER');
  assert.equal(own.loans.length, 1);
  assert(
    own.requests.every((r: { member_id: string }) => r.member_id === member),
  );
  // A noncash loan decision invalidates an earlier closing proposal too.
  await meet('propose', {
    meeting_id: meetingId,
    counted_cash: '27000',
    explanation: '',
  });
  const proposal = (await call('MEETING_SECRETARY', 'GET', meetingPath)).json()
    .meetings[0].proposal.id;
  await meet('approve', { meeting_id: meetingId, proposal_id: proposal });
  const extraQuote = await call('MEETING_SECRETARY', 'POST', path + '/quote', {
    member_id: member,
    meeting_id: meetingId,
    principal: '3000',
    months: '3',
  });
  assert.equal(extraQuote.statusCode, 200, extraQuote.body);
  const extra = await save('request', {
    meeting_id: meetingId,
    member_id: member,
    amount: '3000',
    months: '3',
    policy_id: extraQuote.json().policy_id,
  });
  assert.equal(
    (
      await call(
        'MEETING_TREASURER',
        'POST',
        meetingPath,
        meeting('approve', {
          meeting_id: meetingId,
          proposal_id: proposal,
          device_id: v7(),
        }),
      )
    ).statusCode,
    422,
  );
  await save('cancel', { meeting_id: meetingId, target_id: extra.id });
  await meet('propose', {
    meeting_id: meetingId,
    counted_cash: '27000',
    explanation: '',
  });
  const next = (await call('MEETING_SECRETARY', 'GET', meetingPath)).json()
    .meetings[0].proposal.id;
  await meet('approve', { meeting_id: meetingId, proposal_id: next });
  await meet(
    'approve',
    { meeting_id: meetingId, proposal_id: next, device_id: v7() },
    'MEETING_TREASURER',
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        path,
        fine('reverse', { meeting_id: meetingId, target_id: final.id }),
      )
    ).statusCode,
    422,
  );
  const token = openTokens(
    cookies.get('B')!.slice('yapesa_session='.length),
    config!.cookieKey,
  ).access_token;
  for (const table of [
    'loan_policy',
    'loan_request',
    'loan_approval',
    'loan_cancellation',
    'group_loan',
    'loan_event',
    'loan_schedule',
  ]) {
    const r = await fetch(
      `${config!.supabaseUrl}/rest/v1/${table}?organisation_id=eq.${org}`,
      {
        headers: {
          apikey: config!.publishableKey,
          Authorization: `Bearer ${token}`,
        },
      },
    );
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), []);
  }
  const writerToken = openTokens(
    cookies.get('MEETING_SECRETARY')!.slice('yapesa_session='.length),
    config!.cookieKey,
  ).access_token;
  const direct = await fetch(`${config!.supabaseUrl}/rest/v1/loan_event`, {
    method: 'POST',
    headers: {
      apikey: config!.publishableKey,
      Authorization: `Bearer ${writerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ organisation_id: org }),
  });
  assert.equal(
    direct.status,
    403,
    'Authenticated users cannot insert loan cash rows directly',
  );
  await assert.rejects(
    db.query(
      "update public.loan_event set reason='tampered' where loan_id=$1",
      [loan],
    ),
  );
  assert.equal(secretary !== member, true);
});
test('SQL and shared scheduled-loan calculations agree on generated exact amounts and dates', async () => {
  for (const [principal, n, rate, flat, up, end] of fc.sample(
    fc.tuple(
      fc.bigInt({ min: 120n, max: 1000000000000n }),
      fc.bigInt({ min: 1n, max: 120n }),
      fc.bigInt({ min: 0n, max: 10000n }),
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
    ),
    100,
  )) {
    const policy = {
      ...terms,
      monthly_rate_bps: String(rate),
      max_months: '120',
      method: flat ? 'flat' : 'declining',
      rounding: up ? 'half_up' : 'down',
      dates: end ? 'month_end' : 'original_day',
    };
    const actual = await db.query(
      'select private.loan_schedule($1,$2,$3::jsonb,$4) as schedule',
      [String(principal), '2028-01-31', JSON.stringify(policy), String(n)],
    );
    const expected = loanSchedule(money(principal, 'UGX'), '2028-01-31', {
      months: n,
      monthlyRateBps: rate,
      method: flat ? 'flat' : 'declining',
      rounding: up ? 'half_up' : 'down',
      dates: end ? 'month_end' : 'original_day',
      allocation: 'interest_first',
    }).map((r) => ({
      period: r.period,
      due: r.due,
      principal: String(r.principal.minor),
      interest: String(r.interest.minor),
    }));
    assert.deepEqual(actual.rows[0].schedule, expected);
  }
});
test.after(async () => {
  await app.close();
  await db.end();
});
