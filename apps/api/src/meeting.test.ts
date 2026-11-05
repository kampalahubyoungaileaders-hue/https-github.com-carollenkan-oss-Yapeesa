import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedMeetings } from './meeting.js';
const data = {
  currency: 'UGX',
  meetings: [
    {
      opening_cash: '10000',
      cash_in: '5000',
      cash_out: '1000',
      expected_cash: '14000',
      proposal: {
        expected_cash: '14000',
        counted_cash: '13999',
        difference: '-1',
      },
    },
  ],
};
test('meeting API checks SQL cash arithmetic and counted differences', () => {
  assert.deepEqual(checkedMeetings(data), data);
  assert.throws(() =>
    checkedMeetings({
      ...data,
      meetings: [{ ...data.meetings[0], expected_cash: '15000' }],
    }),
  );
  assert.throws(() =>
    checkedMeetings({
      ...data,
      meetings: [
        {
          ...data.meetings[0],
          proposal: {
            expected_cash: '14000',
            counted_cash: '13999',
            difference: '0',
          },
        },
      ],
    }),
  );
  assert.throws(() =>
    checkedMeetings({
      ...data,
      meetings: [{ ...data.meetings[0], cash_in: '1.5' }],
    }),
  );
});
