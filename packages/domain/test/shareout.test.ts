import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { money, shareOut } from '../src/index.ts';

test('largest remainders preserve every minor unit, quotas and roster-order independence', () => {
  fc.assert(
    fc.property(
      fc.bigInt({ min: 0n, max: 9223372036854775807n }),
      fc.array(fc.bigInt({ min: 1n, max: 1000000000000000000n }), {
        minLength: 1,
        maxLength: 100,
      }),
      (fund, shares) => {
        const members = shares.map((value, index) => ({
          id: String(index).padStart(3, '0'),
          shares: value,
        }));
        const result = shareOut(money(fund, 'UGX'), members);
        assert.equal(
          result.reduce((sum, row) => sum + row.amount.minor, 0n),
          fund,
        );
        assert.deepEqual(
          result,
          shareOut(money(fund, 'UGX'), [...members].reverse()),
        );
        const total = shares.reduce((sum, value) => sum + value, 0n);
        for (const row of result) {
          const weight = members.find((member) => member.id === row.id)!.shares;
          const floor = (fund * weight) / total;
          assert(row.amount.minor === floor || row.amount.minor === floor + 1n);
        }
      },
    ),
  );
});
test('ties use stable member IDs and zero shares receive no allocation', () => {
  assert.deepEqual(
    shareOut(money(2n, 'UGX'), [
      { id: 'c', shares: 1n },
      { id: 'a', shares: 1n },
      { id: 'b', shares: 1n },
      { id: 'z', shares: 0n },
    ]).map((row) => [row.id, row.amount.minor]),
    [
      ['a', 1n],
      ['b', 1n],
      ['c', 0n],
      ['z', 0n],
    ],
  );
  assert.deepEqual(shareOut(money(0n, 'UGX'), []), []);
  assert.throws(() => shareOut(money(1n, 'UGX'), []));
  assert.throws(() => shareOut(money(-1n, 'UGX'), []));
  assert.throws(() => shareOut(money(1n, 'UGX'), [{ id: 'a', shares: -1n }]));
  assert.throws(() =>
    shareOut(money(1n, 'UGX'), [
      { id: 'a', shares: 1n },
      { id: 'a', shares: 1n },
    ]),
  );
});
