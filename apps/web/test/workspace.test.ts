import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialWorkspace,
  parseWorkspace,
  cashBalance,
  appendPurchase,
  appendReversal,
  formatAmount,
  groupById,
  csvCell,
  membersForGroup,
  entriesFor,
  totalShares,
} from '../src/workspace.ts';
const input = {
  id: 'new',
  groupId: 'umoja',
  memberId: 'amina',
  meetingDate: '2026-11-03',
  shares: '2',
  note: '',
  recordedAt: '2026-11-03T10:00:00Z',
};
test('fixed sample snapshot reconciles all group totals and linked corrections', () => {
  const state = initialWorkspace();
  assert.deepEqual(initialWorkspace(), state);
  for (const [id, roster, shares, cash] of [
    ['umoja', 25, 731n, 3655000n],
    ['nakawa', 18, 530n, 1060000n],
    ['kasubi', 15, 440n, 4400000n],
  ] as const) {
    const rows = entriesFor(state, id);
    assert.equal(membersForGroup(id).length, roster);
    assert.equal(new Set(rows.map((row) => row.meetingDate)).size, 12);
    assert.equal(totalShares(rows), shares);
    assert.equal(cashBalance(state, id), cash);
    assert.equal(rows.filter((row) => row.kind === 'reversal').length, 1);
    for (const row of rows)
      assert(membersForGroup(id).some((person) => person.id === row.memberId));
  }
  assert.throws(() =>
    appendPurchase(state, { ...input, memberId: 'kasubi-1' }),
  );
});
test('demo records survive persistence and a purchase/reversal restores the original cash', () => {
  const original = initialWorkspace();
  assert.deepEqual(parseWorkspace(JSON.stringify(original)), original);
  const before = cashBalance(original, 'umoja');
  const purchased = appendPurchase(original, input);
  assert.equal(cashBalance(purchased, 'umoja'), before + 10000n);
  assert.equal(original.entries.length + 1, purchased.entries.length);
  const reversed = appendReversal(
    purchased,
    'new',
    'reverse-new',
    'Wrong member',
    '2026-11-03T10:01:00Z',
  );
  assert.equal(cashBalance(reversed, 'umoja'), before);
  assert.deepEqual(parseWorkspace(JSON.stringify(reversed)), reversed);
  assert.throws(() =>
    appendReversal(reversed, 'new', 'again', 'Reason', input.recordedAt),
  );
  assert.throws(() =>
    appendReversal(
      reversed,
      'reverse-new',
      'again',
      'Reason',
      input.recordedAt,
    ),
  );
});
test('fractional shares, duplicates, calendar errors, cycle dates and meeting limits are rejected', () => {
  const state = initialWorkspace();
  for (const shares of ['1.5', '-1', '0', '6', '1e3'])
    assert.throws(() => appendPurchase(state, { ...input, shares }));
  for (const meetingDate of ['2026-02-30', '2025-12-31', '2027-01-01', 'bad'])
    assert.throws(() => appendPurchase(state, { ...input, meetingDate }));
  const next = appendPurchase(state, { ...input, shares: '4' });
  assert.throws(() => appendPurchase(next, { ...input, id: 'second' }));
  assert.throws(() => appendPurchase(next, input));
  assert.throws(() =>
    parseWorkspace(
      JSON.stringify({
        version: 1,
        entries: [{ ...input, kind: 'other', reverses: null }],
      }),
    ),
  );
});
test('currency formatting preserves large integers and exports cannot inject spreadsheet formulas', () => {
  assert.equal(
    formatAmount(9007199254740993n, groupById('umoja')),
    'UGX 9,007,199,254,740,993',
  );
  assert.equal(csvCell('=CMD()'), '"\'=CMD()"');
  assert.equal(csvCell('  @SUM(A1)'), '"\'  @SUM(A1)"');
  assert.equal(csvCell('A "quote"'), '"A ""quote"""');
});
