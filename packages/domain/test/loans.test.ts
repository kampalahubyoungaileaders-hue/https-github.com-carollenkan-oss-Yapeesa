import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  money,
  loanSchedule,
  loanDueDate,
  allocateLoanPayment,
  loanJournal,
  journalBalance,
  accountBalance,
  type LoanTerms,
} from '../src/index.ts';
const base: LoanTerms = {
  monthlyRateBps: 250n,
  months: 3n,
  method: 'flat',
  rounding: 'half_up',
  allocation: 'interest_first',
  dates: 'original_day',
};
test('loan calendars preserve anchors, leap days, month ends and year boundaries', () => {
  assert.equal(loanDueDate('2028-01-31', 1n, 'original_day'), '2028-02-29');
  assert.equal(loanDueDate('2028-01-31', 2n, 'original_day'), '2028-03-31');
  assert.equal(loanDueDate('2026-12-15', 2n, 'month_end'), '2027-02-28');
  assert.throws(() => loanDueDate('2026-02-29', 1n, 'original_day'));
  assert.throws(() => loanDueDate('9999-12-31', 1n, 'month_end'));
});
test('scheduled principal and interest are exact, with residues in the final instalment', () => {
  const s = loanSchedule(money(10000n, 'UGX'), '2026-01-31', base);
  assert.deepEqual(
    s.map((r) => [r.principal.minor, r.interest.minor]),
    [
      [3333n, 250n],
      [3333n, 250n],
      [3334n, 250n],
    ],
  );
  const d = loanSchedule(money(10000n, 'UGX'), '2026-01-31', {
    ...base,
    method: 'declining',
  });
  assert.equal(
    d.reduce((sum, r) => sum + r.interest.minor, 0n),
    500n,
  );
  fc.assert(
    fc.property(
      fc.bigInt({ min: 1n, max: 1000000000000000n }),
      fc.bigInt({ min: 1n, max: 120n }),
      fc.bigInt({ min: 0n, max: 10000n }),
      fc.boolean(),
      fc.boolean(),
      (p, n, rate, flat, up) => {
        const terms = {
          ...base,
          months: n,
          monthlyRateBps: rate,
          method: flat ? 'flat' : 'declining',
          rounding: up ? 'half_up' : 'down',
        } as const;
        const rows = loanSchedule(money(p, 'UGX'), '2026-01-31', terms);
        assert.equal(
          rows.reduce((sum, r) => sum + r.principal.minor, 0n),
          p,
        );
        const raw = rows.reduce(
          (sum, r) =>
            sum + (flat ? p : p - (p / n) * (BigInt(r.period) - 1n)) * rate,
          0n,
        );
        const totalI = (raw + (up ? 5000n : 0n)) / 10000n;
        assert.equal(
          rows.reduce((sum, r) => sum + r.interest.minor, 0n),
          totalI,
        );
        assert(
          rows.every((r) => r.principal.minor >= 0n && r.interest.minor >= 0n),
        );
        const allocation = allocateLoanPayment(
          rows,
          [],
          money(p + totalI, 'UGX'),
          terms.allocation,
        );
        assert.equal(
          allocation.reduce(
            (sum, r) => sum + r.principal.minor + r.interest.minor,
            0n,
          ),
          p + totalI,
        );
      },
    ),
  );
});
test('partial payments follow chronological instalments and the chosen component order', () => {
  const schedule = loanSchedule(money(10000n, 'UGX'), '2026-01-31', base);
  assert.deepEqual(
    allocateLoanPayment(schedule, [], money(100n, 'UGX'), 'interest_first').map(
      (r) => [r.principal.minor, r.interest.minor],
    ),
    [[0n, 100n]],
  );
  assert.deepEqual(
    allocateLoanPayment(
      schedule,
      [],
      money(100n, 'UGX'),
      'principal_first',
    ).map((r) => [r.principal.minor, r.interest.minor]),
    [[100n, 0n]],
  );
  const first = allocateLoanPayment(
    schedule,
    [],
    money(4000n, 'UGX'),
    'interest_first',
  );
  const next = allocateLoanPayment(
    schedule,
    first,
    money(100n, 'UGX'),
    'interest_first',
  );
  assert.equal(next[0]?.period, '2');
  assert.throws(() =>
    allocateLoanPayment(schedule, [], money(10751n, 'UGX'), 'interest_first'),
  );
});
test('loan cash movements balance independently from shares and social money', () => {
  for (const [p, i] of [
    [-10000n, 0n],
    [1000n, 75n],
    [-1000n, -75n],
    [0n, 75n],
    [0n, -75n],
  ]) {
    const j = loanJournal('loan', money(p!, 'UGX'), money(i!, 'UGX'));
    assert.equal(journalBalance(j), 0n);
    assert.equal(accountBalance([j], 'cash', 'UGX'), p! + i!);
    assert.equal(accountBalance([j], 'loans_receivable', 'UGX'), -p!);
    assert.equal(accountBalance([j], 'interest_income', 'UGX'), -i!);
    assert.equal(accountBalance([j], 'social_fund', 'UGX'), 0n);
  }
  assert.deepEqual(
    loanSchedule(money(2n, 'UGX'), '2026-01-01', base).map(
      (r) => r.principal.minor,
    ),
    [0n, 0n, 2n],
  );
  assert.throws(() =>
    loanSchedule(money(9223372036854775807n, 'UGX'), '2026-01-01', base),
  );
});
