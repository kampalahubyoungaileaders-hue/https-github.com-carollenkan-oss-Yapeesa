import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, appendFile } from 'node:fs/promises';
import { openTokens } from '../apps/api/src/security.js';
import pg from 'pg';
import fc from 'fast-check';
import { v7 } from 'uuid';
import { buildApp } from '../apps/api/src/app.js';
import { readConfig } from '../apps/api/src/config.js';
import {
  money,
  shareJournal,
  accountBalance,
  shareOut,
} from '../packages/domain/src/index.ts';
import { totp } from '../scripts/totp.js';
const env = process.env;
const config = readConfig();
assert(config);
for (const url of [config.supabaseUrl, env['TEST_DB_URL']!])
  assert(
    ['127.0.0.1', 'localhost'].includes(new URL(url).hostname),
    'Integration fixtures require a local stack',
  );
const app = buildApp(config);
const db = new pg.Client({ connectionString: env['TEST_DB_URL'] });
await db.connect();
const origin = config.webOrigin;
const cookies = new Map<string, string>();
async function call(
  label: string,
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
) {
  const response = await app.inject({
    method,
    url,
    headers: {
      origin,
      ...(cookies.has(label) ? { cookie: cookies.get(label)! } : {}),
    },
    ...(payload === undefined
      ? {}
      : { payload: payload as Record<string, unknown> }),
    remoteAddress: url.includes('/statement.pdf')
      ? `127.0.0.${({ A: 31, B: 32, MEMBER: 33, NONE: 34 } as Record<string, number>)[label] ?? 35}`
      : label === 'LOCK'
        ? '127.0.0.8'
        : '127.0.0.7',
  });
  for (const item of response.cookies)
    if (item.name === 'yapesa_session')
      cookies.set(label, `${item.name}=${item.value}`);
  return response;
}
async function login(label: string) {
  const response = await call(label, 'POST', '/api/auth/login', {
    phone: env[`TEST_${label}_PHONE`],
    pin: env['TEST_PIN'],
  });
  assert.equal(response.statusCode, 200, response.body);
  return response;
}
async function verify(label: string) {
  const response = await call(label, 'POST', '/api/auth/mfa/verify', {
    factor_id: env[`TEST_${label}_FACTOR`],
    code: totp(env[`TEST_${label}_TOTP`]!),
  });
  assert.equal(response.statusCode, 200, response.body);
}
test('real Auth, SQL isolation, balanced posting, replay and session revocation', async () => {
  assert.equal((await call('NONE', 'GET', '/api/groups')).statusCode, 401);
  assert.equal(
    (
      await call(
        'NONE',
        'GET',
        `/api/groups/${env['TEST_ORG_A']}/statement.pdf`,
      )
    ).statusCode,
    401,
  );
  const csrf = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: 'https://attacker.invalid' },
    payload: { phone: env['TEST_A_PHONE'], pin: env['TEST_PIN'] },
  });
  assert.equal(csrf.statusCode, 403);
  await login('A');
  assert.equal(
    (
      await call(
        'A',
        'GET',
        `/api/groups/${env['TEST_ORG_A']}/shareout-preview`,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await call('A', 'GET', `/api/groups/${env['TEST_ORG_A']}/statement.pdf`))
      .statusCode,
    403,
  );
  assert.equal(
    (await call('A', 'GET', '/api/groups')).statusCode,
    403,
    'Staff first factor is insufficient',
  );
  await verify('A');
  await login('B');
  await verify('B');
  const a = await call('A', 'GET', '/api/groups');
  assert.deepEqual(
    a.json().map((x: { id: string }) => x.id),
    [env['TEST_ORG_A']],
  );
  assert.equal(
    (await call('A', 'GET', `/api/groups/${env['TEST_ORG_B']}`)).statusCode,
    403,
  );
  const device = v7();
  const previewUrl = `/api/groups/${env['TEST_ORG_A']}/shareout-preview`;
  assert.equal((await call('NONE', 'GET', previewUrl)).statusCode, 401);
  assert.equal((await call('B', 'GET', previewUrl)).statusCode, 403);
  const emptyPreview = await call('A', 'GET', previewUrl);
  assert.equal(emptyPreview.statusCode, 200, emptyPreview.body);
  assert.equal(emptyPreview.json().fund, '0');
  assert.deepEqual(emptyPreview.json().members, []);
  const client = v7();
  const input = {
    member_id: env['TEST_A_PERSON'],
    meeting_date: new Date().toISOString().slice(0, 10),
    shares: '2',
    client_id: client,
    device_id: device,
    client_amount: '9999',
    client_calc_version: 'old-version',
    note: 'integration purchase',
  };
  const url = `/api/groups/${env['TEST_ORG_A']}/shares`;
  const saved = await call('A', 'POST', url, input);
  if (saved.statusCode !== 200) {
    // Local-only diagnostics expose the SQL error, never a credential, when the
    // API's intentionally generic error response cannot identify a migration bug.
    const access = openTokens(
      cookies.get('A')!.slice('yapesa_session='.length),
      config!.cookieKey,
    ).access_token;
    const detail = await fetch(
      `${config!.supabaseUrl}/rest/v1/rpc/post_share_purchase`,
      {
        method: 'POST',
        headers: {
          apikey: config!.publishableKey,
          Authorization: `Bearer ${access}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_org: env['TEST_ORG_A'],
          p_member: input.member_id,
          p_date: input.meeting_date,
          p_shares: input.shares,
          p_client: input.client_id,
          p_device: input.device_id,
          p_client_amount: input.client_amount,
          p_client_version: input.client_calc_version,
          p_note: input.note,
        }),
      },
    );
    assert.equal(detail.status, 200, await detail.text());
  }
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().amount, '10000');
  assert.equal(saved.json().calculation_mismatch, true);
  const replay = await call('A', 'POST', url, input);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), saved.json());
  assert.equal(
    (await call('A', 'POST', url, { ...input, shares: '3' })).statusCode,
    409,
  );
  assert.equal(
    (await call('A', 'POST', url, { ...input, client_id: v7(), shares: 1 }))
      .statusCode,
    400,
    'Numeric money/count values must not be coerced',
  );
  assert.equal(
    (await call('A', 'POST', url, { ...input, client_id: v7(), shares: '4' }))
      .statusCode,
    422,
  );
  const snapshot = await call('A', 'GET', `/api/groups/${env['TEST_ORG_A']}`);
  assert.equal(snapshot.statusCode, 200, snapshot.body);
  assert.equal(snapshot.json().transactions.length, 1);
  assert.equal(snapshot.json().journal_lines.length, 2);
  const pdf = await call(
    'A',
    'GET',
    `/api/groups/${env['TEST_ORG_A']}/statement.pdf`,
  );
  assert.equal(pdf.statusCode, 200, pdf.body);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.headers['cache-control'], 'no-store');
  assert.match(
    String(pdf.headers['content-disposition']),
    /^attachment; filename="yapesa-[a-f0-9-]+\.pdf"$/,
  );
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
  assert.equal(
    (await call('B', 'GET', `/api/groups/${env['TEST_ORG_A']}/statement.pdf`))
      .statusCode,
    403,
  );
  const member = await login('MEMBER');
  assert.equal(member.json().user.requires_mfa, false);
  assert.equal((await call('MEMBER', 'GET', previewUrl)).statusCode, 403);
  const restricted = await call(
    'MEMBER',
    'GET',
    `/api/groups/${env['TEST_ORG_A']}`,
  );
  assert.equal(restricted.statusCode, 200);
  assert.equal(restricted.json().transactions.length, 0);
  const ownPdf = await call(
    'MEMBER',
    'GET',
    `/api/groups/${env['TEST_ORG_A']}/statement.pdf`,
  );
  assert.equal(ownPdf.statusCode, 200, ownPdf.body);
  assert.equal(
    (
      await call(
        'MEMBER',
        'GET',
        `/api/groups/${env['TEST_ORG_A']}/statement.pdf?member_id=${env['TEST_A_PERSON']}`,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        'A',
        'GET',
        `/api/groups/${env['TEST_ORG_A']}/statement.pdf?member_id=invalid`,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call('MEMBER', 'POST', url, {
        ...input,
        client_id: v7(),
        member_id: env['TEST_MEMBER_PERSON'],
      })
    ).statusCode,
    403,
  );
  // Fifty distinct transactions, replayed after acceptance, remain fifty writes.
  const token = openTokens(
    cookies.get('A')!.slice('yapesa_session='.length),
    config!.cookieKey,
  ).access_token;
  const requests = Array.from({ length: 50 }, (_, i) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + i + 1);
    const count = String(1 + (i % 5));
    return {
      p_org: env['TEST_ORG_A'],
      p_member: env['TEST_A_PERSON'],
      p_date: date.toISOString().slice(0, 10),
      p_shares: count,
      p_client: v7(),
      p_device: device,
      p_client_amount: String(5000n * BigInt(count)),
      p_client_version: 'groups-shares-v1',
      p_note: `Replay test ${i}`,
    };
  });
  for (const request of [...requests, ...requests]) {
    const result = await fetch(
      `${config!.supabaseUrl}/rest/v1/rpc/post_share_purchase`,
      {
        method: 'POST',
        headers: {
          apikey: config!.publishableKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      },
    );
    assert.equal(result.status, 200, await result.text());
  }
  const count = await db.query<{ count: string }>(
    'select count(*)::text as count from public.group_txn where organisation_id=$1',
    [env['TEST_ORG_A']],
  );
  assert.equal(count.rows[0]!.count, '51');
  const journalCount = await db.query<{ count: string }>(
    'select count(*)::text as count from public.journal where organisation_id=$1',
    [env['TEST_ORG_A']],
  );
  assert.equal(journalCount.rows[0]!.count, '51');
  // Corrections are real ledger postings, including under concurrent delivery.
  const correctionDate = new Date();
  correctionDate.setUTCDate(correctionDate.getUTCDate() + 80);
  const purchase = {
    ...input,
    client_id: v7(),
    shares: '5',
    client_amount: '25000',
    client_calc_version: 'groups-shares-v1',
    meeting_date: correctionDate.toISOString().slice(0, 10),
  };
  const original = await call('A', 'POST', url, purchase);
  assert.equal(original.statusCode, 200, original.body);
  const reversalUrl = `/api/groups/${env['TEST_ORG_A']}/reversals`;
  const correction = {
    transaction_id: original.json().transaction_id,
    client_id: v7(),
    device_id: device,
    reason: 'Recorded for the wrong meeting',
  };
  assert.equal(
    (await call('MEMBER', 'POST', reversalUrl, correction)).statusCode,
    403,
  );
  assert.equal(
    (await call('B', 'POST', reversalUrl, correction)).statusCode,
    403,
  );
  assert.equal(
    (await call('A', 'POST', reversalUrl, { ...correction, reason: '   ' }))
      .statusCode,
    400,
  );
  assert.equal(
    (await call('A', 'POST', reversalUrl, { ...correction, device_id: v7() }))
      .statusCode,
    403,
  );
  const competing = { ...correction, client_id: v7() };
  const race = await Promise.all([
    call('A', 'POST', reversalUrl, correction),
    call('A', 'POST', reversalUrl, competing),
  ]);
  assert.deepEqual(
    race.map((response) => response.statusCode).sort(),
    [200, 409],
  );
  const winner = race[0]!.statusCode === 200 ? correction : competing;
  const reversed = race.find((response) => response.statusCode === 200)!;
  assert.equal(reversed.json().amount, '-25000');
  const repeat = await call('A', 'POST', reversalUrl, winner);
  assert.equal(repeat.statusCode, 200, repeat.body);
  assert.deepEqual(repeat.json(), reversed.json());
  assert.equal(
    (
      await call('A', 'POST', reversalUrl, {
        ...winner,
        reason: 'Changed payload',
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call('A', 'POST', reversalUrl, {
        ...winner,
        client_id: v7(),
        transaction_id: reversed.json().transaction_id,
      })
    ).statusCode,
    422,
  );
  const correctedWorkspace = (
    await call('A', 'GET', `/api/groups/${env['TEST_ORG_A']}`)
  ).json();
  const correctionRow = correctedWorkspace.transactions.find(
    (row: { id: string }) => row.id === reversed.json().transaction_id,
  );
  assert.equal(correctionRow.reverses, original.json().transaction_id);
  assert.equal(correctionRow.shares, '-5');
  const correctedJournals = await db.query<{ account_id: string; net: string }>(
    `select account_id, sum(case when side='debit' then amount else -amount end)::text as net from public.journal_line where journal_id=any($1::uuid[]) group by account_id`,
    [[original.json().journal_id, reversed.json().journal_id]],
  );
  assert.equal(correctedJournals.rows.length, 2);
  assert(
    correctedJournals.rows.every((row) => row.net === '0'),
    'Every affected account is restored exactly',
  );
  // The full five-share limit is available again after reversing five shares.
  const replacement = await call('A', 'POST', url, {
    ...purchase,
    client_id: v7(),
  });
  assert.equal(replacement.statusCode, 200, replacement.body);
  assert.equal(
    (
      await call('A', 'POST', url, {
        ...purchase,
        client_id: v7(),
        shares: '1',
      })
    ).statusCode,
    422,
  );
  await db.query(
    `update public.meeting set status='closed' where cycle_id=(select id from public.cycle where organisation_id=$1 and status='active') and meeting_date=$2`,
    [env['TEST_ORG_A'], purchase.meeting_date],
  );
  try {
    assert.equal(
      (
        await call('A', 'POST', reversalUrl, {
          ...correction,
          transaction_id: replacement.json().transaction_id,
          client_id: v7(),
        })
      ).statusCode,
      422,
    );
  } finally {
    await db.query(
      `update public.meeting set status='open' where organisation_id=$1 and meeting_date=$2`,
      [env['TEST_ORG_A'], purchase.meeting_date],
    );
  }
  const correctedPdf = await call(
    'A',
    'GET',
    `/api/groups/${env['TEST_ORG_A']}/statement.pdf`,
  );
  assert.equal(correctedPdf.statusCode, 200, correctedPdf.body);
  const preview = await call('A', 'GET', previewUrl);
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.headers['cache-control'], 'no-store');
  const cycleTotals = await db.query<{ fund: string; shares: string }>(
    `select sum(t.amount)::text as fund,sum(t.shares)::text as shares from public.group_txn t join public.meeting m on m.id=t.meeting_id join public.cycle c on c.id=m.cycle_id where t.organisation_id=$1 and c.status='active'`,
    [env['TEST_ORG_A']],
  );
  assert.equal(preview.json().fund, cycleTotals.rows[0]!.fund);
  assert.equal(preview.json().total_shares, cycleTotals.rows[0]!.shares);
  assert.equal(
    preview
      .json()
      .members.reduce(
        (sum: bigint, row: { amount: string }) => sum + BigInt(row.amount),
        0n,
      ),
    BigInt(preview.json().fund),
  );
  // A historical closed-cycle purchase must not enter the active-cycle fund.
  await db.query(
    `with old_cycle as (
    insert into public.cycle(organisation_id,starts_on,ends_on,share_price,status) values($1,current_date-400,current_date-300,5000,'closed') returning id
  ), old_meeting as (
    insert into public.meeting(organisation_id,cycle_id,meeting_date,status) select $1,id,current_date-350,'open' from old_cycle returning id
  ), old_journal as (
    insert into public.journal(organisation_id,currency,calc_version) select organisation_id,currency,calc_version from public.group_txn where id=$2 returning id
  ), old_lines as (
    insert into public.journal_line(organisation_id,journal_id,account_id,side,amount) select l.organisation_id,j.id,l.account_id,l.side,l.amount from public.journal_line l cross join old_journal j where l.journal_id=(select journal_id from public.group_txn where id=$2)
  ) insert into public.group_txn(organisation_id,meeting_id,member_id,client_id,device_id,shares,amount,currency,entered_by,journal_id,note,calc_version,client_calc_version,client_amount,calculation_mismatch)
    select t.organisation_id,m.id,t.member_id,$3,t.device_id,t.shares,t.amount,t.currency,t.entered_by,j.id,'Historical cycle fixture',t.calc_version,t.client_calc_version,t.client_amount,t.calculation_mismatch from public.group_txn t cross join old_meeting m cross join old_journal j where t.id=$2`,
    [env['TEST_ORG_A'], original.json().transaction_id, v7()],
  );
  await db.query(
    `update public.meeting set status='closed' where organisation_id=$1 and id in (select meeting_id from public.group_txn where organisation_id=$1 and note='Historical cycle fixture')`,
    [env['TEST_ORG_A']],
  );
  const afterHistory = await call('A', 'GET', previewUrl);
  assert.equal(afterHistory.statusCode, 200, afterHistory.body);
  assert.deepEqual(afterHistory.json(), preview.json());
  await db.query(
    `update public.membership set ends_at=now() where organisation_id=$1 and person_id=$2 and role='secretary'`,
    [env['TEST_ORG_A'], env['TEST_A_PERSON']],
  );
  try {
    assert.equal((await call('A', 'GET', previewUrl)).statusCode, 403);
  } finally {
    await db.query(
      `update public.membership set ends_at=null where organisation_id=$1 and person_id=$2 and role='secretary'`,
      [env['TEST_ORG_A'], env['TEST_A_PERSON']],
    );
  }
  // SQL and TypeScript allocate the same generated funds, including rounding ties
  // and values beyond JavaScript's safe integer range.
  await fc.assert(
    fc.asyncProperty(
      fc.bigInt({ min: 0n, max: 9223372036854775807n }),
      fc.array(fc.bigInt({ min: 1n, max: 1000000000000000000n }), {
        minLength: 1,
        maxLength: 25,
      }),
      async (fund, weights) => {
        const members = weights.map((shares, index) => ({
          id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          shares,
        }));
        const result = await db.query<{
          allocation: { id: string; amount: string }[];
        }>('select private.shareout_allocation($1,$2::jsonb) as allocation', [
          String(fund),
          JSON.stringify(
            members.map((row) => ({ ...row, shares: String(row.shares) })),
          ),
        ]);
        assert.deepEqual(
          result.rows[0]!.allocation,
          shareOut(money(fund, 'UGX'), members).map((row) => ({
            id: row.id,
            amount: String(row.amount.minor),
          })),
        );
      },
    ),
    { numRuns: 100 },
  );
  for (const [fund, members] of [
    [
      '2',
      [
        { id: '00000000-0000-4000-8000-000000000003', shares: '1' },
        { id: '00000000-0000-4000-8000-000000000001', shares: '1' },
        { id: '00000000-0000-4000-8000-000000000002', shares: '1' },
      ],
    ],
    ['0', []],
    ['0', [{ id: '00000000-0000-4000-8000-000000000001', shares: '0' }]],
  ] as const) {
    const result = await db.query<{
      allocation: { id: string; amount: string }[];
    }>('select private.shareout_allocation($1,$2::jsonb) as allocation', [
      fund,
      JSON.stringify(members),
    ]);
    assert.deepEqual(
      result.rows[0]!.allocation,
      shareOut(
        money(BigInt(fund), 'UGX'),
        members.map((row) => ({ id: row.id, shares: BigInt(row.shares) })),
      ).map((row) => ({ id: row.id, amount: String(row.amount.minor) })),
    );
  }
  await appendFile('.env', `TEST_DEVICE_A=${device}\n`);
  const direct = await fetch(
    `${config!.supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        apikey: config!.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: env['TEST_A_PHONE'],
        password: env['TEST_PIN'],
      }),
    },
  );
  assert(!direct.ok, 'The raw PIN cannot bypass the API gateway');
  // TypeScript and SQL produce exactly the same result for generated amounts.
  await fc.assert(
    fc.asyncProperty(
      fc.bigInt({ min: 1n, max: 1000000000000n }),
      fc.bigInt({ min: 1n, max: 5n }),
      async (price, shares) => {
        const result = await db.query<{ amount: string }>(
          'select private.share_amount($1,$2)::text as amount',
          [String(price), String(shares)],
        );
        const expected = accountBalance(
          [shareJournal('test', money(price, 'UGX'), shares)],
          'cash',
          'UGX',
        );
        assert.equal(result.rows[0]!.amount, String(expected));
      },
    ),
    { numRuns: 50 },
  );
  // SQL attack suite includes every organisation-owned table, direct table
  // writes, factor/membership revocation and immutable/unbalanced journals.
  const sql = await readFile('supabase/tests/secure_shares.sql', 'utf8');
  await db.query(sql);
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await call('LOCK', 'POST', '/api/auth/login', {
          phone: env['TEST_LOCK_PHONE'],
          pin: env['TEST_PIN'] === '000000' ? '000001' : '000000',
        })
      ).statusCode,
      401,
    );
  assert.equal(
    (
      await call('LOCK', 'POST', '/api/auth/login', {
        phone: env['TEST_LOCK_PHONE'],
        pin: env['TEST_PIN'],
      })
    ).statusCode,
    423,
  );
  await call('A', 'POST', '/api/auth/logout', {});
  assert.equal((await call('A', 'GET', previewUrl)).statusCode, 401);
  assert.equal((await call('A', 'GET', '/api/groups')).statusCode, 401);
  assert.equal(
    (await call('A', 'GET', `/api/groups/${env['TEST_ORG_A']}/statement.pdf`))
      .statusCode,
    401,
  );
});
test.after(async () => {
  await app.close();
  await db.end();
});
