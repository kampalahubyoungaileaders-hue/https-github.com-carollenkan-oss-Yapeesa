import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { money, reconcileCash } from '../src/index.ts';
test('cash reconciliation conserves recorded cash and explains every counted difference', () => {
  fc.assert(
    fc.property(
      fc.bigInt({ min: 0n, max: 1000000000000n }),
      fc.bigInt({ min: 0n, max: 1000000000000n }),
      fc.bigInt({ min: 0n, max: 1000000000000n }),
      (opening, income, counted) => {
        const out = (opening + income) / 2n;
        const result = reconcileCash(
          money(opening, 'UGX'),
          money(income, 'UGX'),
          money(out, 'UGX'),
          money(counted, 'UGX'),
        );
        assert.equal(result.expected.minor, opening + income - out);
        assert.equal(result.expected.minor + result.difference.minor, counted);
      },
    ),
  );
});
test('cash cannot be negative, overflow or combine currencies', () => {
  const zero = money(0n, 'UGX');
  assert.throws(() => reconcileCash(zero, zero, money(1n, 'UGX'), zero));
  assert.throws(() => reconcileCash(zero, money(-1n, 'UGX'), zero, zero));
  assert.throws(() => reconcileCash(zero, money(1n, 'USD'), zero, zero));
  assert.throws(() =>
    reconcileCash(
      money(9223372036854775807n, 'UGX'),
      money(1n, 'UGX'),
      zero,
      zero,
    ),
  );
});
