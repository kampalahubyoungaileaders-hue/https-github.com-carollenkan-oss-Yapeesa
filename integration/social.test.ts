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
    'Social fixtures require a disposable local database',
  );
const app = buildApp(config);
const db = new pg.Client({ connectionString: env['TEST_DB_URL'] });
await db.connect();
const org = env['TEST_MEETING_ORG_SOCIAL_INTEGRATION']!;
const path = `/api/groups/${org}/social`;
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
function social(action: string, extra: object = {}) {
  return {
    request_id: v7(),
    device_id: device,
    action,
    meeting_id: null,
    member_id: null,
    target_id: null,
    amount: null,
    reason: '',
    ...extra,
  };
}
async function save(
  action: string,
  extra: object = {},
  label = 'MEETING_SECRETARY',
) {
  const body = social(action, extra);
  const r = await call(label, 'POST', path, body);
  if (r.statusCode !== 200) {
    const token = openTokens(
      cookies.get(label)!.slice('yapesa_session='.length),
      config!.cookieKey,
    ).access_token;
    const detail = await fetch(
      `${config!.supabaseUrl}/rest/v1/rpc/social_command`,
      {
        method: 'POST',
        headers: {
          apikey: config!.publishableKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_org: org,
          p_action: body.action,
          p_request: body.request_id,
          p_device: body.device_id,
          p_meeting: body.meeting_id,
          p_member: body.member_id,
          p_amount: body.amount,
          p_reason: body.reason,
          p_target: body.target_id,
        }),
      },
    );
    assert.equal(detail.status, 200, await detail.text());
  }
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
async function policy(
  amount: string | null,
  roles = ['treasurer'],
  separate = true,
  require_all = true,
) {
  const body = {
    request_id: v7(),
    device_id: device,
    amount,
    roles: amount === null ? [] : roles,
    separate,
    require_all,
  };
  const r = await call(
    'MEETING_ADMIN',
    'POST',
    `/api/admin/groups/${org}/social`,
    body,
  );
  if (r.statusCode !== 200) {
    const token = openTokens(
      cookies.get('MEETING_ADMIN')!.slice('yapesa_session='.length),
      config!.cookieKey,
    ).access_token;
    const detail = await fetch(
      `${config!.supabaseUrl}/rest/v1/rpc/admin_social_rule`,
      {
        method: 'POST',
        headers: {
          apikey: config!.publishableKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_org: org,
          p_request: body.request_id,
          p_device: body.device_id,
          p_amount: body.amount,
          p_roles: body.roles,
          p_separate: body.separate,
          p_require_all: body.require_all,
        }),
      },
    );
    assert.equal(detail.status, 200, await detail.text());
  }
  assert.equal(r.statusCode, 200, r.body);
  return body;
}
test('separate social balance, fixed meeting contributions, role-approved grants, corrections and closing', async () => {
  assert.equal((await call('NONE', 'GET', path)).statusCode, 401);
  await login('MEETING_SECRETARY');
  await login('MEETING_TREASURER');
  await login('MEETING_CHAIR');
  await login('MEETING_ADMIN');
  await login('MEETING_MEMBER', false);
  await login('B');
  assert.equal((await call('B', 'GET', path)).statusCode, 403);
  assert.equal((await ws()).balance, '0');
  assert.equal((await ws()).rule, null);
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const old = (
    await meet('open', { date: yesterday.toISOString().slice(0, 10) })
  ).id;
  await mark(old);
  await meet('propose', {
    meeting_id: old,
    counted_cash: '0',
    explanation: '',
  });
  let oldRow = (await call('MEETING_SECRETARY', 'GET', meetingPath)).json()
    .meetings[0];
  await meet('approve', { meeting_id: old, proposal_id: oldRow.proposal.id });
  await meet(
    'approve',
    { meeting_id: old, proposal_id: oldRow.proposal.id, device_id: v7() },
    'MEETING_TREASURER',
  );
  const configuration = await policy('1000');
  const replay = await call(
    'MEETING_ADMIN',
    'POST',
    `/api/admin/groups/${org}/social`,
    configuration,
  );
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        `/api/admin/groups/${org}/social`,
        { ...configuration, request_id: v7() },
      )
    ).statusCode,
    403,
  );
  const date = new Date().toISOString().slice(0, 10);
  const current = (await meet('open', { date })).id;
  await mark(current);
  assert.equal(
    (await ws()).meetings.find((r: { id: string }) => r.id === current)
      .contribution,
    '1000',
  );
  const close = meeting('propose', {
    meeting_id: current,
    counted_cash: '0',
    explanation: '',
  });
  assert.equal(
    (await call('MEETING_SECRETARY', 'POST', meetingPath, close)).statusCode,
    422,
    'Required contributions gate closing',
  );
  const purchase = await call(
    'MEETING_SECRETARY',
    'POST',
    `/api/groups/${org}/shares`,
    {
      member_id: env['TEST_MEETING_SECRETARY_PERSON'],
      meeting_date: date,
      shares: '3',
      client_id: v7(),
      device_id: device,
      client_amount: '15000',
      client_calc_version: 'groups-shares-v1',
      note: 'Shares stay separate',
    },
  );
  assert.equal(purchase.statusCode, 200, purchase.body);
  const contribution = social('contribute', {
    meeting_id: current,
    member_id: env['TEST_MEETING_SECRETARY_PERSON'],
  });
  let r = await call('MEETING_SECRETARY', 'POST', path, contribution);
  if (r.statusCode !== 200)
    await save('contribute', {
      meeting_id: current,
      member_id: env['TEST_MEETING_SECRETARY_PERSON'],
    });
  assert.equal(r.statusCode, 200, r.body);
  const first = r.json().id as string;
  assert.equal(
    (await call('MEETING_SECRETARY', 'POST', path, contribution)).statusCode,
    200,
  );
  assert.equal(
    (
      await call('MEETING_SECRETARY', 'POST', path, {
        ...contribution,
        request_id: v7(),
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        path,
        social('contribute', {
          meeting_id: current,
          member_id: env['TEST_MEETING_MEMBER_PERSON'],
          amount: '1',
        }),
      )
    ).statusCode,
    422,
  );
  await save('contribute', {
    meeting_id: current,
    member_id: env['TEST_MEETING_MEMBER_PERSON'],
  });
  assert.equal((await ws()).balance, '2000');
  const tooLarge = await save('grant', {
    meeting_id: current,
    member_id: env['TEST_MEETING_MEMBER_PERSON'],
    amount: '16000',
    reason: 'Cannot spend share capital',
  });
  assert.equal(
    (
      await call(
        'MEETING_TREASURER',
        'POST',
        path,
        social('approve', { target_id: tooLarge.id, device_id: v7() }),
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        meetingPath,
        meeting('propose', {
          meeting_id: current,
          counted_cash: '17000',
          explanation: '',
        }),
      )
    ).statusCode,
    422,
    'Pending requests gate closing',
  );
  await save('cancel', { target_id: tooLarge.id });
  const grant = await save('grant', {
    meeting_id: current,
    member_id: env['TEST_MEETING_MEMBER_PERSON'],
    amount: '500',
    reason: 'Member welfare grant',
  });
  assert.equal(
    (
      await call(
        'MEETING_ADMIN',
        'POST',
        path,
        social('approve', { target_id: grant.id, device_id: v7() }),
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        'MEETING_CHAIR',
        'POST',
        path,
        social('approve', { target_id: grant.id, device_id: v7() }),
      )
    ).statusCode,
    403,
  );
  await db.query(
    "insert into public.membership(person_id,organisation_id,role) values($1,$2,'treasurer')",
    [env['TEST_MEETING_SECRETARY_PERSON'], org],
  );
  try {
    assert.equal(
      (
        await call(
          'MEETING_SECRETARY',
          'POST',
          path,
          social('approve', { target_id: grant.id }),
        )
      ).statusCode,
      403,
      'Configured separation also applies to a requester holding an approver role',
    );
  } finally {
    await db.query(
      "delete from public.membership where person_id=$1 and organisation_id=$2 and role='treasurer'",
      [env['TEST_MEETING_SECRETARY_PERSON'], org],
    );
  }
  await policy('2000', ['chair']);
  assert.equal((await ws()).rule.contribution, '2000');
  assert.equal(
    (await ws()).meetings.find((r: { id: string }) => r.id === current)
      .contribution,
    '1000',
    'Meeting rule is immutable',
  );
  const approval = social('approve', { target_id: grant.id, device_id: v7() });
  r = await call('MEETING_TREASURER', 'POST', path, approval);
  if (r.statusCode !== 200)
    await save(
      'approve',
      { target_id: grant.id, device_id: approval.device_id },
      'MEETING_TREASURER',
    );
  assert.equal(r.statusCode, 200, r.body);
  const paid = r.json().id as string;
  assert.equal(
    (await call('MEETING_TREASURER', 'POST', path, approval)).statusCode,
    200,
  );
  assert.equal(
    (
      await call('MEETING_TREASURER', 'POST', path, {
        ...approval,
        request_id: v7(),
      })
    ).statusCode,
    409,
  );
  assert.equal((await ws()).balance, '1500');
  const sharePreview = await call(
    'MEETING_SECRETARY',
    'GET',
    `/api/groups/${org}/shareout-preview`,
  );
  assert.equal(sharePreview.statusCode, 200, sharePreview.body);
  assert.equal(
    sharePreview.json().fund,
    '15000',
    'Social money never enters share-out',
  );
  const group = await call('MEETING_SECRETARY', 'GET', `/api/groups/${org}`);
  assert.equal(group.statusCode, 200, group.body);
  assert.equal(
    group.json().transactions.length,
    1,
    'Share statements retain share-only rows',
  );
  const reverseGrant = await save('reverse', {
    meeting_id: current,
    target_id: paid,
    reason: 'Recorded grant was cancelled before cash changed hands',
  });
  await save(
    'approve',
    { target_id: reverseGrant.id, device_id: v7() },
    'MEETING_TREASURER',
  );
  assert.equal((await ws()).balance, '2000');
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        path,
        social('reverse', {
          meeting_id: current,
          target_id: paid,
          reason: 'Duplicate correction',
        }),
      )
    ).statusCode,
    409,
  );
  const reverseContribution = await save('reverse', {
    meeting_id: current,
    target_id: first,
    reason: 'Correct the member contribution record',
  });
  await save(
    'approve',
    { target_id: reverseContribution.id, device_id: v7() },
    'MEETING_TREASURER',
  );
  assert.equal((await ws()).balance, '1000');
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        meetingPath,
        meeting('propose', {
          meeting_id: current,
          counted_cash: '16000',
          explanation: '',
        }),
      )
    ).statusCode,
    422,
  );
  await save('contribute', {
    meeting_id: current,
    member_id: env['TEST_MEETING_SECRETARY_PERSON'],
  });
  await meet('propose', {
    meeting_id: current,
    counted_cash: '17000',
    explanation: '',
  });
  let row = (await call('MEETING_SECRETARY', 'GET', meetingPath)).json()
    .meetings[0];
  await meet('approve', { meeting_id: current, proposal_id: row.proposal.id });
  const pending = await save('grant', {
    meeting_id: current,
    member_id: env['TEST_MEETING_MEMBER_PERSON'],
    amount: '100',
    reason: 'Proposed after first close approval',
  });
  assert.equal(
    (
      await call(
        'MEETING_TREASURER',
        'POST',
        meetingPath,
        meeting('approve', {
          meeting_id: current,
          proposal_id: row.proposal.id,
          device_id: v7(),
        }),
      )
    ).statusCode,
    422,
  );
  await save('cancel', { target_id: pending.id });
  await meet('propose', {
    meeting_id: current,
    counted_cash: '17000',
    explanation: '',
  });
  row = (await call('MEETING_SECRETARY', 'GET', meetingPath)).json()
    .meetings[0];
  await meet('approve', { meeting_id: current, proposal_id: row.proposal.id });
  await meet(
    'approve',
    { meeting_id: current, proposal_id: row.proposal.id, device_id: v7() },
    'MEETING_TREASURER',
  );
  const closed = (await call('MEETING_SECRETARY', 'GET', meetingPath)).json();
  assert.equal(closed.meetings[0].status, 'closed');
  oldRow = closed.meetings.find((r: { id: string }) => r.id === old);
  assert.equal(
    oldRow.proposal.stale,
    false,
    'Meetings without social activity keep their historical fingerprints',
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        path,
        social('grant', {
          meeting_id: current,
          member_id: env['TEST_MEETING_MEMBER_PERSON'],
          amount: '1',
          reason: 'Closed meeting',
        }),
      )
    ).statusCode,
    422,
  );
  const member = await ws('MEETING_MEMBER');
  assert.equal(member.balance, null);
  assert(
    member.transactions.every(
      (row: { member_id: string }) =>
        row.member_id === env['TEST_MEETING_MEMBER_PERSON'],
    ),
  );
  for (const table of [
    'social_rule',
    'social_meeting_policy',
    'social_request',
    'social_txn',
    'social_resolution',
  ]) {
    const token = openTokens(
      cookies.get('B')!.slice('yapesa_session='.length),
      config!.cookieKey,
    ).access_token;
    const response = await fetch(
      `${config!.supabaseUrl}/rest/v1/${table}?organisation_id=eq.${org}`,
      {
        headers: {
          apikey: config!.publishableKey,
          Authorization: `Bearer ${token}`,
        },
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
    await assert.rejects(
      db.query(
        `update public.${table} set organisation_id=organisation_id where organisation_id=$1`,
        [org],
      ),
      /Append-only record/,
    );
  }
  const balances = await db.query<{ code: string; net: string }>(
    "select a.code,sum(case when l.side='debit' then l.amount else -l.amount end)::text as net from public.journal_line l join public.ledger_account a on a.id=l.account_id where l.organisation_id=$1 group by a.code",
    [org],
  );
  assert.equal(
    balances.rows.find((r) => r.code === 'social_fund')!.net,
    '-2000',
  );
  assert.equal(
    balances.rows.find((r) => r.code === 'share_capital')!.net,
    '-15000',
  );
});
test.after(async () => {
  await app.close();
  await db.end();
});
