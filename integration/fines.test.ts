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
    'Fine fixtures require a disposable local database',
  );
const app = buildApp(config);
const db = new pg.Client({ connectionString: env['TEST_DB_URL'] });
await db.connect();
const org = env['TEST_MEETING_ORG_FINES_INTEGRATION']!;
const path = `/api/groups/${org}/fines`;
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
    code: null,
    amount: null,
    reason: 'Test fine record',
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
const rules = [
  {
    code: 'late',
    name: 'Late arrival',
    amount: '1000',
    trigger: 'manual',
    partial: true,
  },
  {
    code: 'absence',
    name: 'Unexcused absence',
    amount: '500',
    trigger: 'absence',
    partial: false,
  },
];
async function policy(value = rules) {
  const body = { request_id: v7(), device_id: device, rules: value };
  const r = await call(
    'MEETING_ADMIN',
    'POST',
    `/api/admin/groups/${org}/fines`,
    body,
  );
  assert.equal(r.statusCode, 200, r.body);
  return body;
}
test('configured unpaid fines, absence corrections, permanent receipts, later collection and cash/share-out parity', async () => {
  assert.equal((await call('NONE', 'GET', path)).statusCode, 401);
  for (const label of [
    'MEETING_SECRETARY',
    'MEETING_TREASURER',
    'MEETING_ADMIN',
    'B',
  ])
    await login(label);
  await login('MEETING_MEMBER', false);
  assert.equal((await call('B', 'GET', path)).statusCode, 403);
  const settings = await policy();
  assert.equal(
    (
      await call(
        'MEETING_ADMIN',
        'POST',
        `/api/admin/groups/${org}/fines`,
        settings,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        `/api/admin/groups/${org}/fines`,
        { ...settings, request_id: v7() },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call('MEETING_ADMIN', 'POST', `/api/admin/groups/${org}/fines`, {
        ...settings,
        request_id: v7(),
        rules: [{ ...rules[0], amount: '0' }],
      })
    ).statusCode,
    400,
  );
  const dates = [2, 1, 0].map((days) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  });
  const first = (await meet('open', { date: dates[0] })).id;
  const member = env['TEST_MEETING_MEMBER_PERSON']!;
  const secretary = env['TEST_MEETING_SECRETARY_PERSON']!;
  await meet('attendance', {
    meeting_id: first,
    member_id: secretary,
    status: 'present',
  });
  await meet('attendance', {
    meeting_id: first,
    member_id: member,
    status: 'absent',
  });
  let data = await ws();
  assert.equal(data.charges.length, 1);
  assert.equal(data.charges[0].due, '500');
  assert.equal(data.events.length, 0);
  const absence = data.charges[0].id;
  await meet('attendance', {
    meeting_id: first,
    member_id: member,
    status: 'absent',
  });
  assert.equal(
    (await ws()).charges.length,
    1,
    'Repeated absent does not duplicate',
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        path,
        fine('pay', { meeting_id: first, target_id: absence, amount: '250' }),
      )
    ).statusCode,
    422,
    'Full-only fine rejects partial payment',
  );
  const paidAbsence = await save('pay', {
    meeting_id: first,
    target_id: absence,
    amount: '500',
  });
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        meetingPath,
        meeting('attendance', {
          meeting_id: first,
          member_id: member,
          status: 'present',
        }),
      )
    ).statusCode,
    422,
    'Attendance cannot silently remove paid fine',
  );
  await save('reverse', { meeting_id: first, target_id: paidAbsence.id });
  await meet('attendance', {
    meeting_id: first,
    member_id: member,
    status: 'excused',
  });
  data = await ws();
  assert.equal(data.charges[0].due, '0');
  assert.equal(data.charges[0].waived, '500');
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        path,
        fine('reverse', { meeting_id: first, target_id: paidAbsence.id }),
      )
    ).statusCode,
    409,
  );
  // Saved meeting terms survive later administrator changes.
  await policy([{ ...rules[0]!, amount: '2000' }]);
  const late = (
    await save('assess', { meeting_id: first, member_id: member, code: 'late' })
  ).id;
  assert.equal(
    (await ws()).charges.find((r: { id: string }) => r.id === late).amount,
    '1000',
  );
  const forged = fine('assess', {
    meeting_id: first,
    member_id: member,
    code: 'late',
    amount: '1',
  });
  assert.equal(
    (await call('MEETING_SECRETARY', 'POST', path, forged)).statusCode,
    422,
  );
  const purchase = await call(
    'MEETING_SECRETARY',
    'POST',
    `/api/groups/${org}/shares`,
    {
      client_id: v7(),
      device_id: device,
      member_id: secretary,
      meeting_date: dates[0],
      shares: '2',
      note: 'Fine allocation test',
      client_amount: '10000',
      client_calc_version: 'groups-shares-v1',
    },
  );
  assert.equal(purchase.statusCode, 200, purchase.body);
  const retry = fine('pay', {
    meeting_id: first,
    target_id: late,
    amount: '400',
  });
  const payment = await call('MEETING_SECRETARY', 'POST', path, retry);
  assert.equal(payment.statusCode, 200, payment.body);
  const replay = await call('MEETING_SECRETARY', 'POST', path, retry);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), payment.json());
  assert.equal(
    (await call('MEETING_SECRETARY', 'POST', path, { ...retry, amount: '401' }))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await call('MEETING_TREASURER', 'POST', path, {
        ...retry,
        device_id: v7(),
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        path,
        fine('pay', { meeting_id: first, target_id: late, amount: '601' }),
      )
    ).statusCode,
    422,
  );
  let preview = await call(
    'MEETING_SECRETARY',
    'GET',
    `/api/groups/${org}/shareout-preview`,
  );
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().fund, '10400');
  assert.equal(preview.json().scope, 'recorded-shares-and-paid-fines');
  assert.equal(preview.json().members[0].amount, '10400');
  // Noncash changes invalidate approval too, without forcing unpaid fines to be paid.
  await meet('propose', {
    meeting_id: first,
    counted_cash: '10400',
    explanation: '',
  });
  let proposal = (await call('MEETING_SECRETARY', 'GET', meetingPath)).json()
    .meetings[0].proposal;
  await meet('approve', { meeting_id: first, proposal_id: proposal.id });
  const extra = await save('assess', {
    meeting_id: first,
    member_id: secretary,
    code: 'late',
    reason: 'Separate penalty',
  });
  const stale = await call(
    'MEETING_TREASURER',
    'POST',
    meetingPath,
    meeting('approve', {
      meeting_id: first,
      proposal_id: proposal.id,
      device_id: v7(),
    }),
  );
  assert.equal(stale.statusCode, 422);
  await save('waive', {
    meeting_id: first,
    target_id: extra.id,
    reason: 'Recorded against wrong member',
  });
  await meet('propose', {
    meeting_id: first,
    counted_cash: '10400',
    explanation: '',
  });
  proposal = (await call('MEETING_SECRETARY', 'GET', meetingPath)).json()
    .meetings[0].proposal;
  await meet('approve', { meeting_id: first, proposal_id: proposal.id });
  await meet(
    'approve',
    { meeting_id: first, proposal_id: proposal.id, device_id: v7() },
    'MEETING_TREASURER',
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        path,
        fine('waive', { meeting_id: first, target_id: late }),
      )
    ).statusCode,
    422,
  );
  const second = (await meet('open', { date: dates[1] })).id;
  await mark(second);
  assert.equal(
    (await ws()).meetings.find((r: { id: string }) => r.id === second).rules[0]
      .amount,
    '2000',
  );
  await save('pay', { meeting_id: second, target_id: late, amount: '600' });
  data = await ws();
  assert.equal(
    data.charges.find((r: { id: string }) => r.id === late).due,
    '0',
  );
  const firstRow = (await call('MEETING_SECRETARY', 'GET', meetingPath))
    .json()
    .meetings.find((r: { id: string }) => r.id === first);
  assert.equal(
    firstRow.proposal.stale,
    false,
    'Later collections preserve historic close',
  );
  const own = await ws('MEETING_MEMBER');
  assert(own.charges.length > 0);
  assert(
    own.charges.every((r: { member_id: string }) => r.member_id === member),
  );
  assert.equal(
    (
      await call(
        'MEETING_MEMBER',
        'POST',
        path,
        fine('assess', { meeting_id: second, member_id: member, code: 'late' }),
      )
    ).statusCode,
    403,
  );
  // A former member may settle an old obligation without being made liable
  // for this meeting's new mandatory social contribution.
  const carried = await save('assess', {
    meeting_id: second,
    member_id: member,
    code: 'late',
  });
  await meet('propose', {
    meeting_id: second,
    counted_cash: '11000',
    explanation: '',
  });
  const secondProposal = (await call('MEETING_SECRETARY', 'GET', meetingPath))
    .json()
    .meetings.find((r: { id: string }) => r.id === second).proposal.id;
  await meet('approve', { meeting_id: second, proposal_id: secondProposal });
  await meet(
    'approve',
    { meeting_id: second, proposal_id: secondProposal, device_id: v7() },
    'MEETING_TREASURER',
  );
  await db.query(
    "update public.membership set ends_at=now() where organisation_id=$1 and person_id=$2 and role='member'",
    [org, member],
  );
  const socialSettings = await call(
    'MEETING_ADMIN',
    'POST',
    `/api/admin/groups/${org}/social`,
    {
      request_id: v7(),
      device_id: device,
      amount: '100',
      roles: ['treasurer'],
      separate: true,
      require_all: true,
    },
  );
  assert.equal(socialSettings.statusCode, 200, socialSettings.body);
  const third = (await meet('open', { date: dates[2] })).id;
  await meet('attendance', {
    meeting_id: third,
    member_id: secretary,
    status: 'present',
  });
  await save('pay', {
    meeting_id: third,
    target_id: carried.id,
    amount: '2000',
  });
  let thirdRow = (await call('MEETING_SECRETARY', 'GET', meetingPath))
    .json()
    .meetings.find((r: { id: string }) => r.id === third);
  assert.deepEqual(
    thirdRow.roster.map((r: { id: string }) => r.id),
    [secretary],
  );
  const contribution = await call(
    'MEETING_SECRETARY',
    'POST',
    `/api/groups/${org}/social`,
    {
      request_id: v7(),
      device_id: device,
      action: 'contribute',
      meeting_id: third,
      member_id: secretary,
      target_id: null,
      amount: null,
      reason: '',
    },
  );
  assert.equal(contribution.statusCode, 200, contribution.body);
  await meet('propose', {
    meeting_id: third,
    counted_cash: '13100',
    explanation: '',
  });
  thirdRow = (await call('MEETING_SECRETARY', 'GET', meetingPath))
    .json()
    .meetings.find((r: { id: string }) => r.id === third);
  await meet('approve', {
    meeting_id: third,
    proposal_id: thirdRow.proposal.id,
  });
  await meet(
    'approve',
    { meeting_id: third, proposal_id: thirdRow.proposal.id, device_id: v7() },
    'MEETING_TREASURER',
  );
  const token = openTokens(
    cookies.get('B')!.slice('yapesa_session='.length),
    config!.cookieKey,
  ).access_token;
  for (const table of [
    'fine_policy',
    'fine_meeting_policy',
    'fine_charge',
    'fine_event',
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
  const ownToken = openTokens(
    cookies.get('MEETING_SECRETARY')!.slice('yapesa_session='.length),
    config!.cookieKey,
  ).access_token;
  const direct = await fetch(`${config!.supabaseUrl}/rest/v1/fine_event`, {
    method: 'POST',
    headers: {
      apikey: config!.publishableKey,
      Authorization: `Bearer ${ownToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ organisation_id: org }),
  });
  assert.equal(direct.status, 403);
  await assert.rejects(
    db.query('update public.fine_charge set amount=amount+1 where id=$1', [
      late,
    ]),
  );
  const balances = await db.query(
    "select a.code,sum(case when l.side='debit' then l.amount else -l.amount end)::text as net from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=$1 group by a.code",
    [org],
  );
  assert.equal(balances.rows.find((r) => r.code === 'cash').net, '13100');
  assert.equal(
    balances.rows.find((r) => r.code === 'fines_income').net,
    '-3000',
  );
  assert.equal(
    balances.rows.find((r) => r.code === 'share_capital').net,
    '-10000',
  );
  preview = await call(
    'MEETING_SECRETARY',
    'GET',
    `/api/groups/${org}/shareout-preview`,
  );
  assert.equal(preview.json().fund, '13000');
});
test.after(async () => {
  await app.close();
  await db.end();
});
