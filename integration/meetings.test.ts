import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import fc from 'fast-check';
import { v7 } from 'uuid';
import { buildApp } from '../apps/api/src/app.js';
import { readConfig } from '../apps/api/src/config.js';
import { openTokens } from '../apps/api/src/security.js';
import { money, reconcileCash } from '../packages/domain/src/index.ts';
import { totp } from '../scripts/totp.js';
const env = process.env;
const config = readConfig();
assert(config);
for (const url of [config.supabaseUrl, env['TEST_DB_URL']!])
  assert(
    ['127.0.0.1', 'localhost'].includes(new URL(url).hostname),
    'Disposable local meeting fixtures only',
  );
const app = buildApp(config);
const db = new pg.Client({ connectionString: env['TEST_DB_URL'] });
await db.connect();
const cookies = new Map<string, string>();
const org = env['TEST_MEETING_ORG_INTEGRATION']!;
const endpoint = `/api/groups/${org}/meetings`;
const device = v7();
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
    remoteAddress: `127.0.0.${label === 'MEETING_SECRETARY' ? 71 : label === 'MEETING_TREASURER' ? 72 : label === 'MEETING_CHAIR' ? 73 : 74}`,
  });
  for (const cookie of response.cookies)
    if (cookie.name === 'yapesa_session')
      cookies.set(label, `${cookie.name}=${cookie.value}`);
  return response;
}
async function login(label: string, mfa = true) {
  const response = await call(label, 'POST', '/api/auth/login', {
    phone: env[`TEST_${label}_PHONE`],
    pin: env['TEST_PIN'],
  });
  assert.equal(response.statusCode, 200, response.body);
  if (mfa) {
    const verified = await call(label, 'POST', '/api/auth/mfa/verify', {
      factor_id: env[`TEST_${label}_FACTOR`],
      code: totp(env[`TEST_${label}_TOTP`]!),
    });
    assert.equal(verified.statusCode, 200, verified.body);
  }
}
function command(action: string, extra: object = {}) {
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
async function execute(
  action: string,
  extra: object = {},
  label = 'MEETING_SECRETARY',
) {
  const response = await call(label, 'POST', endpoint, command(action, extra));
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as { id: string };
}
async function workspace() {
  const r = await call('MEETING_SECRETARY', 'GET', endpoint);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
function purchase(
  date: string,
  member = env['TEST_MEETING_SECRETARY_PERSON']!,
  shares = '3',
) {
  return {
    member_id: member,
    meeting_date: date,
    shares,
    client_id: v7(),
    device_id: device,
    client_amount: String(BigInt(shares) * 5000n),
    client_calc_version: 'groups-shares-v1',
    note: 'Meeting fixture',
  };
}
async function mark(meeting: string) {
  for (const member of [
    env['TEST_MEETING_SECRETARY_PERSON'],
    env['TEST_MEETING_MEMBER_PERSON'],
  ])
    await execute('attendance', {
      meeting_id: meeting,
      member_id: member,
      status: 'present',
    });
}
test('meeting attendance, immutable snapshots, distinct live officers, cash carry and chronological locking', async () => {
  assert.equal((await call('NONE', 'GET', endpoint)).statusCode, 401);
  await login('MEETING_SECRETARY', false);
  assert.equal(
    (await call('MEETING_SECRETARY', 'GET', endpoint)).statusCode,
    403,
  );
  const verify = await call(
    'MEETING_SECRETARY',
    'POST',
    '/api/auth/mfa/verify',
    {
      factor_id: env['TEST_MEETING_SECRETARY_FACTOR'],
      code: totp(env['TEST_MEETING_SECRETARY_TOTP']!),
    },
  );
  assert.equal(verify.statusCode, 200, verify.body);
  await login('MEETING_TREASURER');
  await login('MEETING_CHAIR');
  await login('MEETING_MEMBER', false);
  await login('MEETING_ADMIN');
  await login('B');
  assert.equal((await call('MEETING_MEMBER', 'GET', endpoint)).statusCode, 403);
  assert.equal((await call('B', 'GET', endpoint)).statusCode, 403);
  const date = new Date().toISOString().slice(0, 10);
  const open = command('open', { date });
  assert.equal(
    (await call('MEETING_TREASURER', 'POST', endpoint, open)).statusCode,
    403,
  );
  const opened = await call('MEETING_SECRETARY', 'POST', endpoint, open);
  if (opened.statusCode !== 200) {
    const access = openTokens(
      cookies.get('MEETING_SECRETARY')!.slice('yapesa_session='.length),
      config!.cookieKey,
    ).access_token;
    const detail = await fetch(
      `${config!.supabaseUrl}/rest/v1/rpc/meeting_command`,
      {
        method: 'POST',
        headers: {
          apikey: config!.publishableKey,
          Authorization: `Bearer ${access}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_org: org,
          p_action: open.action,
          p_request: open.request_id,
          p_device: open.device_id,
          p_date: open.date,
        }),
      },
    );
    assert.equal(detail.status, 200, await detail.text());
  }
  assert.equal(opened.statusCode, 200, opened.body);
  const meeting = opened.json().id as string;
  const replay = await call('MEETING_SECRETARY', 'POST', endpoint, open);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), opened.json());
  assert.equal(
    (
      await call('MEETING_SECRETARY', 'POST', endpoint, {
        ...open,
        date: '2026-01-01',
      })
    ).statusCode,
    409,
  );
  assert.equal((await workspace()).meetings[0].opening_cash, '0');
  assert.equal((await workspace()).meetings[0].roster.length, 2);
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        endpoint,
        command('propose', {
          meeting_id: meeting,
          counted_cash: '0',
          explanation: '',
        }),
      )
    ).statusCode,
    422,
    'Attendance is mandatory before proposal',
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        endpoint,
        command('attendance', {
          meeting_id: meeting,
          member_id: env['TEST_MEETING_MEMBER_PERSON'],
          status: 'present',
          device_id: v7(),
        }),
      )
    ).statusCode,
    403,
  );
  const attendance = command('attendance', {
    meeting_id: meeting,
    member_id: env['TEST_MEETING_MEMBER_PERSON'],
    status: 'absent',
  });
  assert.equal(
    (await call('MEETING_SECRETARY', 'POST', endpoint, attendance)).statusCode,
    200,
  );
  assert.equal(
    (await call('MEETING_SECRETARY', 'POST', endpoint, attendance)).statusCode,
    200,
  );
  await execute('attendance', {
    meeting_id: meeting,
    member_id: env['TEST_MEETING_SECRETARY_PERSON'],
    status: 'present',
  });
  // A role change committed while a command waits for the organisation lock
  // must be rechecked, even if the former secretary remains another officer.
  await db.query('begin');
  await db.query('select pg_advisory_xact_lock(hashtextextended($1::text,0))', [
    org,
  ]);
  const waiting = call(
    'MEETING_SECRETARY',
    'POST',
    endpoint,
    command('attendance', {
      meeting_id: meeting,
      member_id: env['TEST_MEETING_MEMBER_PERSON'],
      status: 'excused',
    }),
  );
  let observed = false;
  try {
    for (let i = 0; i < 40; i++) {
      await db.query('select pg_stat_clear_snapshot()');
      const activity = await db.query<{ waiting: boolean }>(
        "select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and wait_event='advisory' and query like '%meeting_command%') as waiting",
      );
      if (activity.rows[0]!.waiting) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(
      observed,
      'The command must reach the advisory lock before changing its role',
    );
    await db.query(
      "update public.membership set ends_at=now() where organisation_id=$1 and person_id=$2 and role='secretary'",
      [org, env['TEST_MEETING_SECRETARY_PERSON']],
    );
    await db.query(
      "insert into public.membership(person_id,organisation_id,role) values($1,$2,'chair')",
      [env['TEST_MEETING_SECRETARY_PERSON'], org],
    );
    await db.query('commit');
    assert.equal(
      (await waiting).statusCode,
      403,
      'Holding another officer role cannot preserve revoked recording authority',
    );
  } finally {
    await db.query('rollback');
    await waiting;
    await db.query(
      "update public.membership set ends_at=null where organisation_id=$1 and person_id=$2 and role='secretary'",
      [org, env['TEST_MEETING_SECRETARY_PERSON']],
    );
    await db.query(
      "delete from public.membership where organisation_id=$1 and person_id=$2 and role='chair'",
      [org, env['TEST_MEETING_SECRETARY_PERSON']],
    );
  }
  const share = await call(
    'MEETING_SECRETARY',
    'POST',
    `/api/groups/${org}/shares`,
    purchase(date),
  );
  assert.equal(share.statusCode, 200, share.body);
  assert.equal((await workspace()).meetings[0].expected_cash, '15000');
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        endpoint,
        command('propose', {
          meeting_id: meeting,
          counted_cash: '10000',
          explanation: '  ',
        }),
      )
    ).statusCode,
    422,
  );
  await execute('propose', {
    meeting_id: meeting,
    counted_cash: '10000',
    explanation: 'Short count awaiting investigation',
  });
  let row = (await workspace()).meetings[0];
  assert.equal(row.proposal.difference, '-5000');
  const adminView = await call('MEETING_ADMIN', 'GET', endpoint);
  assert.equal(adminView.statusCode, 200, adminView.body);
  assert.equal(adminView.json().can_approve, false);
  assert.equal(
    (
      await call(
        'MEETING_ADMIN',
        'POST',
        endpoint,
        command('approve', {
          meeting_id: meeting,
          proposal_id: row.proposal.id,
          device_id: v7(),
        }),
      )
    ).statusCode,
    403,
    'Platform administration does not grant group signing rights',
  );
  const firstProposal = row.proposal.id as string;
  const approval = command('approve', {
    meeting_id: meeting,
    proposal_id: firstProposal,
  });
  assert.equal(
    (await call('MEETING_SECRETARY', 'POST', endpoint, approval)).statusCode,
    200,
  );
  assert.equal(
    (await call('MEETING_SECRETARY', 'POST', endpoint, approval)).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        endpoint,
        command('approve', { meeting_id: meeting, proposal_id: firstProposal }),
      )
    ).statusCode,
    409,
    'One person cannot be two officers',
  );
  const added = await call(
    'MEETING_SECRETARY',
    'POST',
    `/api/groups/${org}/shares`,
    purchase(date, env['TEST_MEETING_MEMBER_PERSON'], '1'),
  );
  assert.equal(added.statusCode, 200, added.body);
  assert.equal((await workspace()).meetings[0].proposal.stale, true);
  assert.equal(
    (
      await call(
        'MEETING_TREASURER',
        'POST',
        endpoint,
        command('approve', {
          meeting_id: meeting,
          proposal_id: firstProposal,
          device_id: v7(),
        }),
      )
    ).statusCode,
    422,
  );
  await execute('propose', {
    meeting_id: meeting,
    counted_cash: '19000',
    explanation: 'Cash shortage of 1000 recorded for investigation',
  });
  row = (await workspace()).meetings[0];
  const proposal = row.proposal.id as string;
  await execute(
    'approve',
    { meeting_id: meeting, proposal_id: proposal, device_id: v7() },
    'MEETING_CHAIR',
  );
  await db.query(
    "update public.membership set ends_at=now() where organisation_id=$1 and person_id=$2 and role='chair'",
    [org, env['TEST_MEETING_CHAIR_PERSON']],
  );
  try {
    await execute(
      'approve',
      { meeting_id: meeting, proposal_id: proposal, device_id: v7() },
      'MEETING_TREASURER',
    );
    row = (await workspace()).meetings[0];
    assert.equal(
      row.status,
      'open',
      'Revoked officer signature is not counted',
    );
    assert.equal(
      row.proposal.approvals.filter((a: { eligible: boolean }) => a.eligible)
        .length,
      1,
    );
  } finally {
    await db.query(
      "update public.membership set ends_at=null where organisation_id=$1 and person_id=$2 and role='chair'",
      [org, env['TEST_MEETING_CHAIR_PERSON']],
    );
  }
  await execute('approve', { meeting_id: meeting, proposal_id: proposal });
  row = (await workspace()).meetings[0];
  assert.equal(row.status, 'closed');
  assert.equal(row.proposal.counted_cash, '19000');
  assert.equal(row.proposal.difference, '-1000');
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        `/api/groups/${org}/shares`,
        purchase(date),
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        endpoint,
        command('attendance', {
          meeting_id: meeting,
          member_id: env['TEST_MEETING_MEMBER_PERSON'],
          status: 'excused',
        }),
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call('MEETING_SECRETARY', 'POST', `/api/groups/${org}/reversals`, {
        transaction_id: share.json().transaction_id,
        client_id: v7(),
        device_id: device,
        reason: 'Closed meeting cannot be edited',
      })
    ).statusCode,
    422,
  );
  const nextDate = new Date();
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const tomorrow = nextDate.toISOString().slice(0, 10);
  const second = (await execute('open', { date: tomorrow })).id;
  assert.equal(
    (await workspace()).meetings[0].opening_cash,
    '19000',
    'Counted physical cash is carried, not silently corrected ledger cash',
  );
  await mark(second);
  await execute('propose', {
    meeting_id: second,
    counted_cash: '19000',
    explanation: '',
  });
  row = (await workspace()).meetings[0];
  const secondProposal = row.proposal.id as string;
  await execute('approve', { meeting_id: second, proposal_id: secondProposal });
  const race = await Promise.all([
    call(
      'MEETING_TREASURER',
      'POST',
      endpoint,
      command('approve', {
        meeting_id: second,
        proposal_id: secondProposal,
        device_id: v7(),
      }),
    ),
    call(
      'MEETING_SECRETARY',
      'POST',
      `/api/groups/${org}/shares`,
      purchase(tomorrow, env['TEST_MEETING_MEMBER_PERSON'], '1'),
    ),
  ]);
  assert.deepEqual(race.map((r) => r.statusCode).sort(), [200, 422]);
  row = (await workspace()).meetings[0];
  if (row.status === 'open') {
    assert.equal(row.proposal.stale, true);
    await execute('propose', {
      meeting_id: second,
      counted_cash: '24000',
      explanation: '',
    });
    row = (await workspace()).meetings[0];
    await execute('approve', {
      meeting_id: second,
      proposal_id: row.proposal.id,
    });
    await execute(
      'approve',
      { meeting_id: second, proposal_id: row.proposal.id, device_id: v7() },
      'MEETING_TREASURER',
    );
  }
  assert.equal((await workspace()).meetings[0].status, 'closed');
  const earlier = new Date();
  earlier.setUTCDate(earlier.getUTCDate() - 1);
  assert.equal(
    (
      await call(
        'MEETING_SECRETARY',
        'POST',
        `/api/groups/${org}/shares`,
        purchase(earlier.toISOString().slice(0, 10)),
      )
    ).statusCode,
    422,
    'Backdating cannot alter verified history',
  );
  const count = await db.query<{ count: string }>(
    'select count(*)::text as count from public.attendance where meeting_id=$1',
    [meeting],
  );
  assert.equal(count.rows[0]!.count, '2', 'Attendance replay is deduplicated');
  for (const table of [
    'meeting_session',
    'meeting_roster',
    'attendance',
    'meeting_closing',
    'meeting_approval',
  ]) {
    const access = openTokens(
      cookies.get('B')!.slice('yapesa_session='.length),
      config!.cookieKey,
    ).access_token;
    const r = await fetch(
      `${config!.supabaseUrl}/rest/v1/${table}?organisation_id=eq.${org}`,
      {
        headers: {
          apikey: config!.publishableKey,
          Authorization: `Bearer ${access}`,
        },
      },
    );
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), []);
    await assert.rejects(
      db.query(
        `update public.${table} set organisation_id=organisation_id where organisation_id=$1`,
        [org],
      ),
      /Append-only record/,
    );
  }
  const memberAccess = openTokens(
    cookies.get('MEETING_MEMBER')!.slice('yapesa_session='.length),
    config!.cookieKey,
  ).access_token;
  const own = await fetch(
    `${config!.supabaseUrl}/rest/v1/attendance?organisation_id=eq.${org}`,
    {
      headers: {
        apikey: config!.publishableKey,
        Authorization: `Bearer ${memberAccess}`,
      },
    },
  );
  assert.equal(own.status, 200);
  const ownRows = (await own.json()) as { member_id: string }[];
  assert(ownRows.length >= 2);
  assert(
    ownRows.every((row) => row.member_id === env['TEST_MEETING_MEMBER_PERSON']),
    'A member can read only their own attendance',
  );
  const staffAccess = openTokens(
    cookies.get('MEETING_SECRETARY')!.slice('yapesa_session='.length),
    config!.cookieKey,
  ).access_token;
  const forged = await fetch(
    `${config!.supabaseUrl}/rest/v1/meeting_approval`,
    {
      method: 'POST',
      headers: {
        apikey: config!.publishableKey,
        Authorization: `Bearer ${staffAccess}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        organisation_id: org,
        meeting_id: meeting,
        closing_id: proposal,
        officer_id: env['TEST_MEETING_TREASURER_PERSON'],
        device_id: device,
      }),
    },
  );
  assert.equal(
    forged.status,
    403,
    'Direct forged approvals have no table-write privilege',
  );
  const audits = await db.query<{ count: string }>(
    "select count(*)::text as count from public.audit_log where organisation_id=$1 and action='meeting_propose' and record_id in (select id from public.meeting_closing where organisation_id=$1)",
    [org],
  );
  assert(
    Number(audits.rows[0]!.count) >= 2,
    'Audits link directly to immutable closing records',
  );
  const role = await db.query<{ ledger: boolean; auth: boolean }>(
    "select has_table_privilege('yapesa_meetings','public.journal','INSERT') as ledger,has_table_privilege('yapesa_meetings','auth.users','UPDATE') as auth",
  );
  assert.deepEqual(role.rows[0], { ledger: false, auth: false });
  await fc.assert(
    fc.asyncProperty(
      fc.bigInt({ min: 0n, max: 1000000000000n }),
      fc.bigInt({ min: 0n, max: 1000000000000n }),
      fc.bigInt({ min: 0n, max: 1000000000000n }),
      async (opening, income, counted) => {
        const out = (opening + income) / 2n;
        const expected = reconcileCash(
          money(opening, 'UGX'),
          money(income, 'UGX'),
          money(out, 'UGX'),
          money(counted, 'UGX'),
        );
        const r = await db.query<{
          result: { expected_cash: string; difference: string };
        }>('select private.cash_reconciliation($1,$2,$3,$4) as result', [
          String(opening),
          String(income),
          String(out),
          String(counted),
        ]);
        assert.equal(
          r.rows[0]!.result.expected_cash,
          String(expected.expected.minor),
        );
        assert.equal(
          r.rows[0]!.result.difference,
          String(expected.difference.minor),
        );
      },
    ),
    { numRuns: 100 },
  );
});
test.after(async () => {
  await app.close();
  await db.end();
});
