import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderStatement,
  statementAmount,
  statementData,
} from './statement.js';
const group = {
  name: 'Coopérative des épargnants',
  currency: 'UGX',
  minor_digits: 0,
  time_zone: 'Africa/Kampala',
};
const transaction = {
  member_id: 'member-a',
  meeting_date: '2026-11-04',
  recorded_at: '2026-11-04T12:00:00Z',
  shares: '2',
  amount: '10000',
  currency: 'UGX',
  journal_id: '019a4c42-2020-7000-8000-000000000001',
  calculation_mismatch: true,
  note: 'Café (recorded) \\ ledger entry',
};
const workspace = {
  group,
  members: [
    { id: 'member-a', name: 'Alidé N.' },
    { id: 'member-b', name: 'Grace N.' },
  ],
  transactions: [
    transaction,
    { ...transaction, member_id: 'member-b', amount: '9007199254740993' },
  ],
};
test('statement filters only authorized workspace rows and rejects missing members', () => {
  const data = statementData(workspace, 'member-a');
  assert.equal(data.member, 'Alidé N.');
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0]!.amount, '10000');
  assert(data.rows[0]!.review);
  assert.throws(() => statementData(workspace, 'not-visible'));
  assert.equal(
    statementData({ ...workspace, transactions: [] }).rows.length,
    0,
  );
  assert.throws(() =>
    statementData({
      ...workspace,
      transactions: [{ ...transaction, currency: 'KES' }],
    }),
  );
  assert.throws(() =>
    statementData({
      ...workspace,
      transactions: [{ ...transaction, amount: '1.1' }],
    }),
  );
  assert.throws(
    () =>
      statementData({
        ...workspace,
        transactions: Array.from({ length: 5001 }, () => transaction),
      }),
    /STATEMENT_TOO_LARGE/,
  );
});
test('statement amounts preserve minor units beyond JavaScript safe integers', () => {
  assert.equal(statementAmount(9007199254740993n, 0), '9007199254740993');
  assert.equal(statementAmount(9007199254740993n, 2), '90071992547409.93');
  assert.equal(statementAmount(1n, 4), '0.0001');
  assert.equal(statementAmount(-1n, 2), '-0.01');
  assert.equal(statementAmount(-10001n, 2), '-100.01');
});
test('statements retain linked reversals and signed totals without accepting arbitrary negative purchases', async () => {
  const reversed = {
    ...transaction,
    shares: '-2',
    amount: '-10000',
    reverses: 'original-transaction',
    journal_id: 'reversal-journal',
  };
  const data = statementData({
    ...workspace,
    transactions: [transaction, reversed],
  });
  assert.equal(
    data.rows.reduce((sum, row) => sum + BigInt(row.amount), 0n),
    0n,
  );
  assert.equal(
    data.rows.reduce((sum, row) => sum + BigInt(row.shares), 0n),
    0n,
  );
  assert.match(
    data.rows.find((row) => row.journal === 'reversal-journal')!.note,
    /original-transaction/,
  );
  assert.equal(
    (await renderStatement(data)).subarray(0, 5).toString(),
    '%PDF-',
  );
  assert.throws(() =>
    statementData({
      ...workspace,
      transactions: [{ ...reversed, reverses: null }],
    }),
  );
  assert.throws(() =>
    statementData({
      ...workspace,
      transactions: [{ ...reversed, shares: '2' }],
    }),
  );
});
test('PDF uses an embedded font and paginates long names and notes', async () => {
  const data = statementData(workspace);
  const single = await renderStatement(data);
  assert.equal(
    (single.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length,
    1,
    'Page footer must not create a blank page',
  );
  data.rows = Array.from({ length: 80 }, () => ({
    ...data.rows[0]!,
    name: 'Long member name '.repeat(9),
    note: 'Full note text '.repeat(17),
  }));
  const pdf = await renderStatement(data, new Date('2026-11-04T12:30:00Z'));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.subarray(-30).toString(), /%%EOF/);
  assert((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length > 1);
  assert.match(pdf.toString('latin1'), /\/FontFile2/);
});
