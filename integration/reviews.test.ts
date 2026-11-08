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
    'Disposable review fixtures only',
  );
const app = buildApp(config),
  db = new pg.Client({ connectionString: env['TEST_DB_URL'] });
await db.connect();
const org = env['TEST_MEETING_ORG_REVIEWS_INTEGRATION']!,
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
async function ws(label = sec) {
  const r = await call(label, 'GET', `${root}/reviews`);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.headers['cache-control'], 'no-store');
  return r.json();
}
function review(action: string, extra: object = {}) {
  return {
    request_id: v7(),
    device_id: device,
    action,
    kind: null,
    source_type: null,
    source_id: null,
    review_id: null,
    proposal_id: null,
    outcome: null,
    reason: '',
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
test('two real group officers review original calculations and closed records without changing money', async () => {
  for (const label of [sec, treas, chair, member, admin]) {
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
  assert.equal((await call(member, 'GET', `${root}/reviews`)).statusCode, 403);
  assert.equal((await ws(admin)).can_decide, false);
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
        allocation: 'interest_first',
        dates: 'original_day',
        roles: ['treasurer'],
        separate: true,
        approvals: '1',
      },
    },
    admin,
  );
  const date = new Date().toISOString().slice(0, 10),
    mid = (await ok(`${root}/meetings`, meeting('open', { date }))).id;
  const purchase = await ok(`${root}/shares`, {
    client_id: v7(),
    device_id: device,
    member_id: env['TEST_MEETING_SECRETARY_PERSON'],
    meeting_date: date,
    shares: '1',
    client_amount: '9007199254740993',
    client_calc_version: 'old-client-v0',
    note: 'Client discrepancy recorded for review',
  });
  assert.equal(purchase.calculation_mismatch, true);
  const book = (
    await db.query(
      "select count(*)::text n,sum(case when side='debit' then amount else -amount end)::text balance from public.journal_line where organisation_id=$1",
      [org],
    )
  ).rows[0];
  const request = review('open', {
    kind: 'calculation',
    source_type: 'share_calculation',
    source_id: purchase.transaction_id,
    reason: 'Compare original client result with the posted server amount',
  });
  const created = await ok(`${root}/reviews`, request);
  assert.deepEqual(await ok(`${root}/reviews`, request), created);
  assert.equal(
    (await call(treas, 'POST', `${root}/reviews`, request)).statusCode,
    409,
    'Another actor cannot replay the receipt',
  );
  assert.equal(
    (
      await call(sec, 'POST', `${root}/reviews`, {
        ...request,
        request_id: v7(),
      })
    ).statusCode,
    409,
    'One review per original source',
  );
  assert.equal(
    (
      await call(
        admin,
        'POST',
        `${root}/reviews`,
        review('propose', {
          review_id: created.id,
          outcome: 'confirmed',
          reason: 'Admin is not a group officer',
        }),
      )
    ).statusCode,
    403,
  );
  let data = await ws();
  const item = data.reviews[0];
  assert.equal(item.source.amount, '5000');
  assert.equal(item.source.shares, '1');
  assert.equal(item.source.client_amount, '9007199254740993');
  assert.equal(data.mismatches[0].review_id, created.id);
  const proposal = (
    await ok(
      `${root}/reviews`,
      review('propose', {
        review_id: created.id,
        outcome: 'confirmed',
        reason: 'Server result matches the signed meeting record',
      }),
    )
  ).id;
  const firstApproval = review('approve', {
    review_id: created.id,
    proposal_id: proposal,
  });
  await ok(`${root}/reviews`, firstApproval);
  assert.deepEqual(
    await ok(`${root}/reviews`, firstApproval),
    await ok(`${root}/reviews`, firstApproval),
  );
  assert.equal((await ws()).reviews[0].resolution, null);
  assert.equal(
    (
      await call(
        sec,
        'POST',
        `${root}/reviews`,
        review('approve', { review_id: created.id, proposal_id: proposal }),
      )
    ).statusCode,
    409,
  );
  const replacement = (
    await ok(
      `${root}/reviews`,
      review('propose', {
        review_id: created.id,
        outcome: 'correction_required',
        reason: 'Further evidence requires correction review; no money changes',
      }),
    )
  ).id;
  assert.equal(
    (
      await call(
        treas,
        'POST',
        `${root}/reviews`,
        review('approve', { review_id: created.id, proposal_id: proposal }),
      )
    ).statusCode,
    422,
    'Earlier proposal cannot gather fresh consent',
  );
  await ok(
    `${root}/reviews`,
    review('approve', { review_id: created.id, proposal_id: replacement }),
  );
  await db.query(
    "update public.membership set ends_at=now() where organisation_id=$1 and person_id=$2 and role='secretary'",
    [org, env['TEST_MEETING_SECRETARY_PERSON']],
  );
  await ok(
    `${root}/reviews`,
    review('approve', { review_id: created.id, proposal_id: replacement }),
    treas,
  );
  assert.equal(
    (await ws(treas)).reviews[0].resolution,
    null,
    'Revoked officer approval does not count',
  );
  await ok(
    `${root}/reviews`,
    review('approve', { review_id: created.id, proposal_id: replacement }),
    chair,
  );
  await db.query(
    "update public.membership set ends_at=null where organisation_id=$1 and person_id=$2 and role='secretary'",
    [org, env['TEST_MEETING_SECRETARY_PERSON']],
  );
  data = await ws();
  assert.equal(data.reviews[0].resolution.outcome, 'correction_required');
  assert.equal(
    (
      await call(
        sec,
        'POST',
        `${root}/reviews`,
        review('propose', {
          review_id: created.id,
          outcome: 'confirmed',
          reason: 'Cannot overwrite the two-officer decision',
        }),
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        sec,
        'POST',
        `${root}/reviews`,
        review('open', {
          kind: 'closed_record',
          source_type: 'meeting',
          source_id: mid,
          reason: 'An open meeting is not a closed-record source',
        }),
      )
    ).statusCode,
    422,
  );
  const quote = await ok(`${root}/loans/quote`, {
    member_id: env['TEST_MEETING_SECRETARY_PERSON'],
    meeting_id: mid,
    principal: '1000',
    months: '1',
  });
  const loanCommand = {
    request_id: v7(),
    device_id: device,
    action: 'request',
    meeting_id: mid,
    member_id: env['TEST_MEETING_SECRETARY_PERSON'],
    target_id: null,
    policy_id: quote.policy_id,
    amount: '1000',
    months: '1',
    reason: 'Saved older client preview',
    calculation: { calc_version: 'older', principal: '1', interest: '0' },
  };
  const loan = await ok(`${root}/loans`, loanCommand);
  await ok(`${root}/loans`, {
    request_id: v7(),
    device_id: device,
    action: 'cancel',
    meeting_id: mid,
    member_id: null,
    target_id: loan.id,
    policy_id: null,
    amount: null,
    months: null,
    reason: 'Cancel the pending request before closing',
  });
  const loanCase = (
    await ok(
      `${root}/reviews`,
      review('open', {
        kind: 'calculation',
        source_type: 'loan_calculation',
        source_id: loanCommand.request_id,
        reason: 'Review saved loan quote discrepancy',
      }),
    )
  ).id;
  data = await ws();
  const loanReview = data.reviews.find(
    (r: { id: string }) => r.id === loanCase,
  );
  assert.equal(loanReview.source.submitted.principal, '1');
  assert.equal(loanReview.source.authoritative.principal, '1000');
  for (const label of [sec, member])
    await ok(
      `${root}/meetings`,
      meeting('attendance', {
        meeting_id: mid,
        member_id: env[`TEST_${label}_PERSON`],
        status: 'present',
      }),
    );
  await ok(
    `${root}/meetings`,
    meeting('propose', {
      meeting_id: mid,
      counted_cash: '5000',
      explanation: '',
    }),
  );
  const mws = await call(sec, 'GET', `${root}/meetings`);
  assert.equal(mws.statusCode, 200, mws.body);
  const closing = mws.json().meetings.find((m: { id: string }) => m.id === mid)
    .proposal.id;
  await ok(
    `${root}/meetings`,
    meeting('approve', { meeting_id: mid, proposal_id: closing }),
  );
  await ok(
    `${root}/meetings`,
    meeting('approve', { meeting_id: mid, proposal_id: closing }),
    treas,
  );
  const closed = (
    await ok(
      `${root}/reviews`,
      review('open', {
        kind: 'closed_record',
        source_type: 'meeting',
        source_id: mid,
        reason: 'Audit the closed cash count without reopening money',
      }),
    )
  ).id;
  const decision = (
    await ok(
      `${root}/reviews`,
      review('propose', {
        review_id: closed,
        outcome: 'confirmed',
        reason: 'Both officers confirm the preserved closing record',
      }),
    )
  ).id;
  await ok(
    `${root}/reviews`,
    review('approve', { review_id: closed, proposal_id: decision }),
  );
  await ok(
    `${root}/reviews`,
    review('approve', { review_id: closed, proposal_id: decision }),
    treas,
  );
  data = await ws();
  assert.equal(
    data.reviews.find((r: { id: string }) => r.id === closed).resolution
      .outcome,
    'confirmed',
  );
  const after = (
    await db.query(
      "select count(*)::text n,sum(case when side='debit' then amount else -amount end)::text balance from public.journal_line where organisation_id=$1",
      [org],
    )
  ).rows[0];
  assert.deepEqual(after, book, 'Reviews cannot change any journal');
  assert.equal(
    (
      await db.query(
        'select calculation_mismatch from public.group_txn where id=$1',
        [purchase.transaction_id],
      )
    ).rows[0].calculation_mismatch,
    true,
  );
  assert.equal(
    (await db.query('select status from public.meeting where id=$1', [mid]))
      .rows[0].status,
    'closed',
  );
  const token = openTokens(
    cookies.get(sec)!.slice('yapesa_session='.length),
    config!.cookieKey,
  ).access_token;
  for (const table of [
    'group_review',
    'review_proposal',
    'review_approval',
    'review_resolution',
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
    assert.equal(r.status, 403);
  }
  assert.equal(
    (
      await db.query(
        "select has_table_privilege('yapesa_reviews','public.journal_line','INSERT') as allowed",
      )
    ).rows[0].allowed,
    false,
  );
});
test.after(async () => {
  await app.close();
  await db.end();
});
