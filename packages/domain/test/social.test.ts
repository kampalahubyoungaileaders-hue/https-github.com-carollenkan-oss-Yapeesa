import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  money,
  socialJournal,
  reverseJournal,
  journalBalance,
  accountBalance,
} from '../src/index.ts';
test('social contributions, grants and exact reversals balance without touching share capital', () => {
  fc.assert(
    fc.property(
      fc.bigInt({ min: 1n, max: 9223372036854775807n }),
      fc.boolean(),
      (amount, incoming) => {
        const cash = incoming ? amount : -amount;
        const journal = socialJournal('social', money(cash, 'UGX'));
        const reversal = reverseJournal('undo', journal);
        assert.equal(journalBalance(journal), 0n);
        assert.equal(accountBalance([journal], 'cash', 'UGX'), cash);
        assert.equal(accountBalance([journal], 'social_fund', 'UGX'), -cash);
        assert.equal(accountBalance([journal], 'share_capital', 'UGX'), 0n);
        assert.equal(accountBalance([journal, reversal], 'cash', 'UGX'), 0n);
        assert.equal(
          accountBalance([journal, reversal], 'social_fund', 'UGX'),
          0n,
        );
      },
    ),
  );
  assert.throws(() => socialJournal('zero', money(0n, 'UGX')));
});
