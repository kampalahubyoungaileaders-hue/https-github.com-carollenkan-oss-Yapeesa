import test from 'node:test';
import assert from 'node:assert/strict';
import { auditData, renderAudit } from './audit.js';
import { ApiError } from './backend.js';
const group = '00000000-0000-4000-8000-000000000001';
const from = '2026-01-01',
  to = '2026-12-31';
function fixture() {
  return {
    group_id: group,
    group_name: 'Audit layout fixture - Nassáli',
    currency: 'UGX',
    minor_digits: 0,
    time_zone: 'Africa/Kampala',
    from_date: from,
    to_date: to,
    record_reference: null,
    exported_by: '00000000-0000-4000-8000-000000000002',
    exported_by_name: 'Nassáli',
    event_count: '1',
    source_count: '1',
    line_count: '2',
    events: [
      {
        id: '00000000-0000-4000-8000-000000000003',
        record_id: '00000000-0000-4000-8000-000000000004',
        actor_id: '00000000-0000-4000-8000-000000000002',
        actor_name: 'Nassáli',
        device_id: '00000000-0000-4000-8000-000000000005',
        action: 'post_share_purchase',
        occurred_at: '2026-11-08T12:00:00Z',
        evidence:
          '{"amount":9007199254740993,"note":"original source evidence"}',
      },
    ],
    sources: [
      {
        id: '00000000-0000-4000-8000-000000000004',
        kind: 'share_transaction',
        evidence:
          '{"amount":9007199254740993,"client_amount":"9007199254740993"}',
      },
    ],
    journals: [
      {
        id: '00000000-0000-4000-8000-000000000006',
        created_at: '2026-11-08T12:00:00Z',
        currency: 'UGX',
        calc_version: 'groups-shares-v1',
        lines: [
          {
            id: '00000000-0000-4000-8000-000000000007',
            account: 'cash',
            side: 'debit',
            amount: '9007199254740993',
          },
          {
            id: '00000000-0000-4000-8000-000000000008',
            account: 'share_capital',
            side: 'credit',
            amount: '9007199254740993',
          },
        ],
      },
    ],
  };
}
test('audit evidence preserves source integer text and rejects wrong scope, partial evidence and unbalanced journals', () => {
  const original = fixture(),
    parsed = auditData(original, group, from, to);
  assert.equal(parsed.events[0]!.evidence, original.events[0]!.evidence);
  assert.equal(parsed.journals[0]!.lines[0]!.amount, '9007199254740993');
  for (const mutate of [
    (value: ReturnType<typeof fixture>) => {
      value.group_id = 'another-group';
    },
    (value: ReturnType<typeof fixture>) => {
      value.from_date = '2026-02-01';
    },
    (value: ReturnType<typeof fixture>) => {
      value.event_count = '2';
    },
    (value: ReturnType<typeof fixture>) => {
      value.journals[0]!.lines[1]!.amount = '9007199254740992';
    },
    (value: ReturnType<typeof fixture>) => {
      value.journals[0]!.currency = 'USD';
    },
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(
      () => auditData(value, group, from, to),
      (error: unknown) =>
        error instanceof ApiError && error.code === 'INVALID_BACKEND_RESPONSE',
    );
  }
  const large = fixture();
  large.events[0]!.evidence = 'x'.repeat(2000001);
  assert.throws(
    () => auditData(large, group, from, to),
    (error: unknown) =>
      error instanceof ApiError && error.code === 'AUDIT_TOO_LARGE',
  );
});
test('audit PDFs embed fonts and paginate complete evidence without dropping linked journals', async () => {
  const value = fixture();
  value.events = Array.from({ length: 12 }, (_, i) => ({
    ...value.events[0]!,
    id: `event-${i}`,
    evidence: JSON.stringify({
      note: 'Long audit evidence with names and saved values. '.repeat(12),
      original_integer: '9007199254740993',
    }),
  }));
  value.event_count = '12';
  const pdf = await renderAudit(
    auditData(value, group, from, to),
    new Date('2026-11-08T12:30:00Z'),
  );
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert(pdf.toString('latin1').includes('/FontFile2'));
  assert((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length >= 2);
});
