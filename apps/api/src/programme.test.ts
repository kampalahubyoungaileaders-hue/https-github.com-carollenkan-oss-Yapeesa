import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedProgramme } from './programme.js';
const id = '00000000-0000-4000-8000-000000000001';
function fixture() {
  return {
    id,
    name: 'Local programme fixture',
    as_of: '2026-11-09',
    time_zone: 'Africa/Kampala',
    groups: [
      {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Group fixture',
        status: 'active',
        currency: 'UGX',
        minor_digits: 0,
        time_zone: 'Africa/Kampala',
        members: '25',
        last_meeting: '2026-10-01',
        days_since_meeting: '39',
        meeting_attention: true,
        repayment_attention: true,
        share_contributions: '9007199254740993',
        outstanding_principal: '9007199254740993',
        arrears: '9007199254740993',
        loans_in_arrears: '1',
        ageing: {
          days_1_30: '0',
          days_31_60: '9007199254740993',
          days_61_90: '0',
          days_over_90: '0',
        },
        trends: Array.from({ length: 12 }, (_, i) => ({
          month: new Date(Date.UTC(2025, 11 + i, 1)).toISOString().slice(0, 10),
          meetings: '1',
          roster: '25',
          present: '20',
          absent: '2',
          excused: '1',
          scheduled_due: '5000',
          repayments: '-1000',
          shares: '5000',
        })),
      },
    ],
  };
}
test('programme totals preserve exact integers per currency and return aggregate fields only', () => {
  const f = fixture();
  f.groups.push({
    ...structuredClone(f.groups[0]!),
    id: '00000000-0000-4000-8000-000000000003',
    currency: 'KES',
    minor_digits: 2,
  });
  const raw = { ...f, secret: 'not returned' };
  const r = checkedProgramme(raw, id);
  assert.equal(r.currencies.length, 2);
  assert.deepEqual(
    r.currencies.map((c) => [c.currency, c.arrears]),
    [
      ['KES', '9007199254740993'],
      ['UGX', '9007199254740993'],
    ],
  );
  assert(!JSON.stringify(r).includes('not returned'));
  assert.equal(r.groups[0]!.trends[0]!.repayments, '-1000');
});
test('programme checks reject scope, health, ageing, attendance and truncated trend inconsistencies', () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.id = 'foreign';
    },
    (f: ReturnType<typeof fixture>) => {
      f.groups[0]!.ageing.days_31_60 = '1';
    },
    (f: ReturnType<typeof fixture>) => {
      f.groups[0]!.meeting_attention = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.groups[0]!.trends[0]!.present = '26';
    },
    (f: ReturnType<typeof fixture>) => {
      f.groups[0]!.trends.pop();
    },
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => checkedProgramme(f, id), {
      code: 'INVALID_BACKEND_RESPONSE',
    });
  }
  assert.throws(() => checkedProgramme(fixture(), id, '2026-11-08'), {
    code: 'INVALID_BACKEND_RESPONSE',
  });
});
