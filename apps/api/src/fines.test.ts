import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedFines } from './fines.js';
const data = {
  currency: 'UGX',
  charges: [
    { id: 'charge', amount: '1000', paid: '400', waived: '100', due: '500' },
  ],
  events: [
    {
      charge_id: 'charge',
      kind: 'payment',
      cash: '400',
      waived: '0',
      journal_id: 'receipt',
      journal: [
        { account: 'cash', side: 'debit', amount: '400' },
        { account: 'fines_income', side: 'credit', amount: '400' },
      ],
    },
    {
      charge_id: 'charge',
      kind: 'waiver',
      cash: '0',
      waived: '100',
      journal_id: null,
      journal: [],
    },
  ],
};
test('API checks fine receipt journals and outstanding obligations independently', () => {
  assert.deepEqual(checkedFines(data), data);
  assert.throws(() =>
    checkedFines({ ...data, charges: [{ ...data.charges[0], due: '499' }] }),
  );
  assert.throws(() =>
    checkedFines({
      ...data,
      events: [{ ...data.events[0], cash: '401' }, data.events[1]],
    }),
  );
  assert.throws(() =>
    checkedFines({
      ...data,
      events: [data.events[0], { ...data.events[1], cash: '100' }],
    }),
  );
  assert.throws(() => checkedFines({ ...data, charges: [] }));
});
