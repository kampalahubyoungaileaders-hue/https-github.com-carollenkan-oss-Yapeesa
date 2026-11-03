import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  money,
  shareJournal,
  reverseJournal,
  journalBalance,
  accountBalance,
} from '../src/index.ts';

test('generated share purchases balance exactly, including large integers', () => {
  fc.assert(
    fc.property(
      fc.bigInt({ min: 1n, max: 1_000_000_000_000n }),
      fc.bigInt({ min: 1n, max: 100n }),
      (price, shares) => {
        const journal = shareJournal('purchase', money(price, 'UGX'), shares);
        assert.equal(journalBalance(journal), 0n);
        assert.equal(accountBalance([journal], 'cash', 'UGX'), price * shares);
        assert.equal(
          accountBalance([journal], 'share_capital', 'UGX'),
          -(price * shares),
        );
        const reversal = reverseJournal('reversal', journal);
        assert.equal(journalBalance(reversal), 0n);
        assert.equal(accountBalance([journal, reversal], 'cash', 'UGX'), 0n);
        assert.equal(
          accountBalance([journal, reversal], 'share_capital', 'UGX'),
          0n,
        );
      },
    ),
  );
});

test('zero shares, negative prices, bigint overflow and mixed currencies are rejected', () => {
  assert.throws(() => shareJournal('bad', money(5000n, 'UGX'), 0n));
  assert.throws(() => shareJournal('bad', money(-1n, 'UGX'), 1n));
  assert.throws(() => money(9223372036854775808n, 'UGX'));
  assert.throws(() =>
    shareJournal('bad', money(9223372036854775807n, 'UGX'), 2n),
  );
  assert.throws(() => money(1n, 'not-a-currency'));
  const journal = shareJournal('valid', money(5000n, 'UGX'), 2n);
  assert.throws(() => accountBalance([journal], 'cash', 'USD'));
});
