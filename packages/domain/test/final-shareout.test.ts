import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  money,
  shareOutCommitJournal,
  shareOutPayoutJournal,
  journalBalance,
  accountBalance,
  shareOut,
} from '../src/index.ts';
test('approved entitlement and individual cash receipts clear the payable exactly', () => {
  fc.assert(
    fc.property(
      fc.bigInt({ min: 0n, max: 1000000000000000000n }),
      fc.bigInt({ min: 0n, max: 1000000000000000000n }),
      fc.bigInt({ min: 0n, max: 1000000000000000000n }),
      (c, f, i) => {
        const commit = shareOutCommitJournal(
          'c',
          money(c, 'UGX'),
          money(f, 'UGX'),
          money(i, 'UGX'),
        );
        if (!commit) {
          assert.equal(c + f + i, 0n);
          return;
        }
        assert.equal(journalBalance(commit), 0n);
        assert.equal(accountBalance([commit], 'cash', 'UGX'), 0n);
        const allocations = shareOut(money(c + f + i, 'UGX'), [
          { id: 'a', shares: 2n },
          { id: 'b', shares: 1n },
        ]);
        const payments = allocations
          .filter((a) => a.amount.minor > 0n)
          .map((a) => shareOutPayoutJournal(a.id, a.amount));
        for (const p of payments) assert.equal(journalBalance(p), 0n);
        assert.equal(
          accountBalance([commit, ...payments], 'shareout_payable', 'UGX'),
          0n,
        );
        assert.equal(accountBalance(payments, 'cash', 'UGX'), -(c + f + i));
      },
    ),
    { numRuns: 300 },
  );
  assert.throws(() => shareOutPayoutJournal('x', money(0n, 'UGX')));
  assert.throws(() =>
    shareOutCommitJournal(
      'x',
      money(-1n, 'UGX'),
      money(0n, 'UGX'),
      money(0n, 'UGX'),
    ),
  );
  assert.throws(() =>
    shareOutCommitJournal(
      'x',
      money(0n, 'UGX'),
      money(1n, 'KES'),
      money(0n, 'UGX'),
    ),
  );
});
