import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedSocial } from './social.js';
const data = {
  currency: 'UGX',
  balance: '1000',
  transactions: [
    {
      journal_id: 'test',
      cash: '1000',
      journal: [
        { account: 'cash', side: 'debit', amount: '1000' },
        { account: 'social_fund', side: 'credit', amount: '1000' },
      ],
    },
  ],
};
test('API independently verifies social journals and fund totals', () => {
  assert.deepEqual(checkedSocial(data), data);
  assert.throws(() => checkedSocial({ ...data, balance: '999' }));
  assert.throws(() =>
    checkedSocial({
      ...data,
      transactions: [
        {
          ...data.transactions[0],
          journal: [
            { account: 'cash', side: 'debit', amount: '999' },
            { account: 'social_fund', side: 'credit', amount: '999' },
          ],
        },
      ],
    }),
  );
  assert.throws(() =>
    checkedSocial({
      ...data,
      transactions: [{ ...data.transactions[0], cash: '0' }],
    }),
  );
});
