import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedShareOut } from './shareout.js';
const preview = {
  calc_version: 'groups-shareout-preview-v1',
  scope: 'recorded-shares-only',
  fund: '5',
  total_shares: '3',
  currency: 'UGX',
  members: [
    { id: 'a', shares: '1', amount: '2' },
    { id: 'b', shares: '2', amount: '3' },
  ],
};
test('API accepts only SQL allocations matching the shared calculator and totals', () => {
  assert.deepEqual(checkedShareOut(preview), preview);
  assert.throws(() => checkedShareOut({ ...preview, total_shares: '4' }));
  assert.throws(() => checkedShareOut({ ...preview, fund: '6' }));
  assert.throws(() => checkedShareOut({ ...preview, fund: '5.0' }));
  assert.throws(() =>
    checkedShareOut({ ...preview, calc_version: 'old-version' }),
  );
  assert.throws(() => checkedShareOut({ ...preview, scope: 'all-cash' }));
  assert.throws(() =>
    checkedShareOut({
      ...preview,
      members: [preview.members[0], preview.members[0]],
    }),
  );
  assert.throws(() =>
    checkedShareOut({
      ...preview,
      members: [{ id: 'a', shares: '-1', amount: '5' }],
    }),
  );
  assert.throws(() =>
    checkedShareOut({
      ...preview,
      members: [{ id: 'a', shares: '3', amount: '4' }],
    }),
  );
});
