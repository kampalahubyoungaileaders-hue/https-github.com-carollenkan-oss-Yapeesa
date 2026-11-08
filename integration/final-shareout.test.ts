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
    'Disposable fixtures only',
  );
const app = buildApp(config),
  db = new pg.Client({ connectionString: env['TEST_DB_URL'] });
await db.connect();
const org = env['TEST_MEETING_ORG_SHAREOUT_INTEGRATION']!,
  root = `/api/groups/${org}`,
  device = v7(),
  cookies = new Map<string, string>();
const secretary = 'MEETING_SECRETARY',
  treasurer = 'MEETING_TREASURER',
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
    remoteAddress: `127.0.0.${[secretary, treasurer, chair, member, admin].indexOf(label) + 101}`,
  });
  for (const c of r.cookies)
    if (c.name === 'yapesa_session') cookies.set(label, `${c.name}=${c.value}`);
  return r;
}
async function ok(url: string, payload: object, label = secretary) {
  const r = await call(label, 'POST', url, payload);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function ws() {
  const r = await call(secretary, 'GET', `${root}/shareout`);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.headers['cache-control'], 'no-store');
  return r.json();
}
function cmd(action: string, extra: object = {}) {
  return {
    request_id: v7(),
    device_id: device,
    action,
    plan_id: null,
    allocation_id: null,
    reason: '',
    confirmed: true,
    ...extra,
  };
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
async function meet(action: string, extra: object = {}, label = secretary) {
  return ok(`${root}/meetings`, meeting(action, extra), label);
}
async function close(id: string, count: string, explanation = '') {
  for (const label of [secretary, member])
    await meet('attendance', {
      meeting_id: id,
      member_id: env[`TEST_${label}_PERSON`],
      status: 'present',
    });
  const p = await meet('propose', {
    meeting_id: id,
    counted_cash: count,
    explanation,
  });
  await meet('approve', { meeting_id: id, proposal_id: p.id });
  await meet('approve', { meeting_id: id, proposal_id: p.id }, treasurer);
}
const date = (offset = 0) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
test('final allocation requires settled cash, two officers and exact individual receipts, then preserves Social cash', async () => {
  for (const label of [secretary, treasurer, chair, member, admin]) {
    await ok(
      '/api/auth/login',
      { phone: env[`TEST_${label}_PHONE`], pin: env['TEST_PIN'] },
      label,
    );
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
  for (const label of [member, admin])
    assert.equal(
      (await call(label, 'GET', `${root}/shareout`)).statusCode,
      403,
    );
  assert.equal(
    (await call(secretary, 'POST', `${root}/shareout`, cmd('prepare')))
      .statusCode,
    422,
  );
  await ok(
    `/api/admin/groups/${org}/social`,
    {
      request_id: v7(),
      device_id: device,
      amount: '1000',
      roles: ['treasurer'],
      separate: true,
      require_all: false,
    },
    admin,
  );
  await ok(
    `/api/admin/groups/${org}/fines`,
    {
      request_id: v7(),
      device_id: device,
      rules: [
        {
          code: 'late',
          name: 'Late arrival',
          amount: '1000',
          trigger: 'manual',
          partial: true,
        },
      ],
    },
    admin,
  );
  await ok(
    `/api/admin/groups/${org}/loans`,
    {
      request_id: v7(),
      device_id: device,
      policy: {
        monthly_rate_bps: '100',
        multiple: '3',
        max_months: '3',
        method: 'flat',
        rounding: 'half_up',
        allocation: 'principal_first',
        dates: 'original_day',
        roles: ['treasurer'],
        separate: true,
        approvals: '1',
      },
    },
    admin,
  );
  const mid = (await meet('open', { date: date() })).id;
  const purchases = [];
  for (const [who, shares] of [
    [secretary, '2'],
    [member, '1'],
  ]) {
    const b = {
      client_id: v7(),
      device_id: device,
      member_id: env[`TEST_${who}_PERSON`],
      meeting_date: date(),
      shares,
      client_amount: String(BigInt(shares!) * 5000n),
      client_calc_version: 'groups-shares-v1',
      note: 'Final-cycle savings',
    };
    await ok(`${root}/shares`, b);
    purchases.push(b);
  }
  await ok(`${root}/social`, {
    request_id: v7(),
    device_id: device,
    action: 'contribute',
    meeting_id: mid,
    member_id: env['TEST_MEETING_MEMBER_PERSON'],
    amount: null,
    target_id: null,
    reason: '',
  });
  const fine = (
    await ok(`${root}/fines`, {
      request_id: v7(),
      device_id: device,
      action: 'assess',
      meeting_id: mid,
      member_id: env['TEST_MEETING_MEMBER_PERSON'],
      target_id: null,
      code: 'late',
      amount: null,
      reason: 'Late arrival',
    })
  ).id;
  assert(
    (await ws()).readiness.blockers.some((s: string) =>
      s.includes('unpaid fines'),
    ),
  );
  await ok(`${root}/fines`, {
    request_id: v7(),
    device_id: device,
    action: 'pay',
    meeting_id: mid,
    member_id: null,
    target_id: fine,
    code: null,
    amount: '400',
    reason: 'Cash received',
  });
  await ok(`${root}/fines`, {
    request_id: v7(),
    device_id: device,
    action: 'waive',
    meeting_id: mid,
    member_id: null,
    target_id: fine,
    code: null,
    amount: null,
    reason: 'Group explicitly waived the remaining fine',
  });
  const quote = await ok(`${root}/loans/quote`, {
    member_id: env['TEST_MEETING_MEMBER_PERSON'],
    meeting_id: mid,
    principal: '1000',
    months: '1',
  });
  const loanBody = (action: string, extra: object = {}) => ({
    request_id: v7(),
    device_id: device,
    action,
    meeting_id: mid,
    member_id: null,
    target_id: null,
    policy_id: null,
    amount: null,
    months: null,
    reason: 'Loan test record',
    ...extra,
  });
  const req = (
    await ok(
      `${root}/loans`,
      loanBody('request', {
        member_id: env['TEST_MEETING_MEMBER_PERSON'],
        policy_id: quote.policy_id,
        amount: '1000',
        months: '1',
      }),
    )
  ).id;
  assert(
    (await ws()).readiness.blockers.some((s: string) =>
      s.includes('pending loan'),
    ),
  );
  await ok(
    `${root}/loans`,
    loanBody('approve', { target_id: req, reason: '' }),
    treasurer,
  );
  await ok(`${root}/loans`, loanBody('disburse', { target_id: req }));
  const loans = await call(secretary, 'GET', `${root}/loans`);
  assert.equal(loans.statusCode, 200, loans.body);
  const loan = loans.json().loans[0].id;
  await ok(
    `${root}/loans`,
    loanBody('repay', { target_id: loan, amount: '1000' }),
  );
  assert(
    (await ws()).readiness.blockers.some((s: string) =>
      s.includes('agreed interest'),
    ),
    'Principal settled but agreed interest still blocks closure',
  );
  await ok(
    `${root}/loans`,
    loanBody('repay', { target_id: loan, amount: '10' }),
  );
  await close(mid, '16410');
  let state = await ws();
  assert.deepEqual(state.readiness.blockers, []);
  assert.equal(state.readiness.snapshot.preview.fund, '15410');
  assert.equal(state.readiness.snapshot.social, '1000');
  const first = await ok(`${root}/shareout`, cmd('prepare'));
  await ok(`${root}/shareout`, cmd('approve', { plan_id: first.id }));
  const next = (await meet('open', { date: date(1) })).id;
  assert.equal(
    (
      await call(
        treasurer,
        'POST',
        `${root}/shareout`,
        cmd('approve', { plan_id: first.id }),
      )
    ).statusCode,
    422,
    'An open meeting stales final approval',
  );
  await close(next, '16409', 'One minor unit not yet found');
  assert(
    (await ws()).readiness.blockers.some((s: string) =>
      s.includes('reconcile'),
    ),
  );
  const last = (await meet('open', { date: date(2) })).id;
  await close(
    last,
    '16410',
    'Previously missing minor unit recovered and counted',
  );
  const prepared = cmd('prepare');
  const plan = await ok(`${root}/shareout`, prepared);
  assert.deepEqual(await ok(`${root}/shareout`, prepared), plan);
  assert.equal(
    (
      await call(
        treasurer,
        'POST',
        `${root}/shareout`,
        cmd('approve', { plan_id: first.id }),
      )
    ).statusCode,
    422,
    'Replaced proposal cannot be approved',
  );
  const approval = cmd('approve', { plan_id: plan.id });
  await ok(`${root}/shareout`, approval);
  assert.equal((await ws()).plan.committed, false);
  assert.equal(
    (
      await call(
        secretary,
        'POST',
        `${root}/shareout`,
        cmd('approve', { plan_id: plan.id }),
      )
    ).statusCode,
    409,
    'One person cannot count twice',
  );
  await db.query(
    "update public.membership set ends_at=now() where organisation_id=$1 and person_id=$2 and role='secretary'",
    [org, env['TEST_MEETING_SECRETARY_PERSON']],
  );
  await ok(`${root}/shareout`, cmd('approve', { plan_id: plan.id }), treasurer);
  const uncommitted = await call(treasurer, 'GET', `${root}/shareout`);
  assert.equal(uncommitted.statusCode, 200, uncommitted.body);
  assert.equal(
    uncommitted.json().plan.committed,
    false,
    'Revoked officer consent is not counted',
  );
  await ok(`${root}/shareout`, cmd('approve', { plan_id: plan.id }), chair);
  await db.query(
    "update public.membership set ends_at=null where organisation_id=$1 and person_id=$2 and role='secretary'",
    [org, env['TEST_MEETING_SECRETARY_PERSON']],
  );
  state = await ws();
  assert.equal(state.plan.committed, true);
  assert.equal(state.plan.allocations.length, 2);
  assert.deepEqual(
    state.plan.allocations.map((a: { amount: string }) => a.amount).sort(),
    ['10273', '5137'],
  );
  assert.equal(
    (
      await call(
        secretary,
        'POST',
        `${root}/shareout`,
        cmd('finish', { plan_id: plan.id }),
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        secretary,
        'POST',
        `${root}/meetings`,
        meeting('open', { date: date(3) }),
      )
    ).statusCode,
    422,
    'Approved distribution freezes legacy meeting command',
  );
  assert.equal(
    (await call(secretary, 'POST', `${root}/shareout`, cmd('prepare')))
      .statusCode,
    422,
  );
  const receiptCmd = cmd('pay', {
    plan_id: plan.id,
    allocation_id: state.plan.allocations[0].id,
    reason: 'Acknowledged cash handover receipt 1',
  });
  assert.equal(
    (await call(treasurer, 'POST', `${root}/shareout`, receiptCmd)).statusCode,
    403,
  );
  assert.equal(
    (
      await call(secretary, 'POST', `${root}/shareout`, {
        ...receiptCmd,
        confirmed: false,
      })
    ).statusCode,
    400,
  );
  const receipt = await ok(`${root}/shareout`, receiptCmd);
  assert.deepEqual(await ok(`${root}/shareout`, receiptCmd), receipt);
  assert.equal(
    (
      await call(secretary, 'POST', `${root}/shareout`, {
        ...receiptCmd,
        reason: 'Changed',
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(secretary, 'POST', `${root}/shareout`, {
        ...receiptCmd,
        request_id: v7(),
      })
    ).statusCode,
    422,
  );
  await ok(
    `${root}/shareout`,
    cmd('pay', {
      plan_id: plan.id,
      allocation_id: state.plan.allocations[1].id,
      reason: 'Acknowledged cash handover receipt 2',
    }),
  );
  const finish = cmd('finish', { plan_id: plan.id });
  await ok(`${root}/shareout`, finish);
  assert.deepEqual(
    await ok(`${root}/shareout`, finish),
    await ok(`${root}/shareout`, finish),
  );
  assert.deepEqual(await ok(`${root}/shareout`, receiptCmd), receipt);
  state = await ws();
  assert.equal(state.plan.finalized, true);
  assert(state.plan.allocations.every((a: { receipt: unknown }) => a.receipt));
  const replayed = await ok(`${root}/shares`, purchases[0]!);
  assert.equal(
    replayed.amount,
    '10000',
    'Existing purchase receipt remains replayable after closure',
  );
  const balances = await db.query(
    "select a.code,sum(case when l.side='debit' then l.amount else -l.amount end)::text balance from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=$1 group by a.code",
    [org],
  );
  const b = Object.fromEntries(balances.rows.map((r) => [r.code, r.balance]));
  assert.equal(b.cash, '1000');
  assert.equal(b.social_fund, '-1000');
  assert.equal(b.shareout_payable, '0');
  assert.equal(b.share_capital, '0');
  assert.equal(b.interest_income, '0');
  assert.equal(b.fines_income, '0');
  const token = openTokens(
    cookies.get(secretary)!.slice('yapesa_session='.length),
    config!.cookieKey,
  ).access_token;
  for (const table of [
    'shareout_plan',
    'shareout_approval',
    'shareout_commit',
    'share_out',
    'shareout_receipt',
    'shareout_finalization',
  ]) {
    const r = await fetch(`${config!.supabaseUrl}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: config!.publishableKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(r.status, 403, `${table} has no direct write grant`);
  }
  const other = await call(
    secretary,
    'GET',
    `/api/groups/${env['TEST_MEETING_ORG_LOANS_INTEGRATION']}/shareout`,
  );
  assert.equal(other.statusCode, 200, other.body);
  assert.notEqual(other.json().plan?.id, plan.id);
});
test.after(async () => {
  await app.close();
  await db.end();
});
