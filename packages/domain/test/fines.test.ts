import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  money,
  fineJournal,
  fineOutstanding,
  journalBalance,
  reverseJournal,
  accountBalance,
} from '../src/index.ts';
test('fine receipts and exact corrections balance; unpaid obligations never become cash', () => {
  fc.assert(
    fc.property(
      fc.bigInt({ min: 1n, max: 9223372036854775807n }),
      fc.nat(),
      (amount, n) => {
        const paid = BigInt(n) % amount;
        const waived = (amount - paid) / 2n;
        assert.equal(
          fineOutstanding(
            money(amount, 'UGX'),
            money(paid, 'UGX'),
            money(waived, 'UGX'),
          ).minor,
          amount - paid - waived,
        );
        const receipt = fineJournal('fine', money(amount, 'UGX'));
        assert.equal(journalBalance(receipt), 0n);
        assert.equal(accountBalance([receipt], 'cash', 'UGX'), amount);
        assert.equal(accountBalance([receipt], 'fines_income', 'UGX'), -amount);
        assert.equal(accountBalance([receipt], 'share_capital', 'UGX'), 0n);
        assert.equal(accountBalance([receipt], 'social_fund', 'UGX'), 0n);
        assert.equal(
          accountBalance(
            [receipt, reverseJournal('undo', receipt)],
            'cash',
            'UGX',
          ),
          0n,
        );
      },
    ),
  );
  assert.throws(() =>
    fineOutstanding(money(100n, 'UGX'), money(101n, 'UGX'), money(0n, 'UGX')),
  );
  assert.throws(() =>
    fineOutstanding(money(100n, 'UGX'), money(0n, 'USD'), money(0n, 'UGX')),
  );
  assert.throws(() => fineJournal('zero', money(0n, 'UGX')));
});
