import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedLoans, checkedLoanQuote } from './loans.js';
const terms = {
  monthly_rate_bps: '250',
  method: 'declining',
  multiple: '3',
  max_months: '3',
  rounding: 'half_up',
  allocation: 'interest_first',
  dates: 'original_day',
  roles: ['treasurer'],
  separate: true,
  approvals: '1',
};
const schedule = [
  { period: '1', due: '2026-02-28', principal: '3333', interest: '250' },
  { period: '2', due: '2026-03-31', principal: '3333', interest: '166' },
  { period: '3', due: '2026-04-30', principal: '3334', interest: '84' },
];
const quote = {
  currency: 'UGX',
  principal: '10000',
  months: '3',
  start: '2026-01-31',
  terms,
  schedule,
  borrowable: '30000',
  available_cash: '20000',
};
const book = {
  currency: 'UGX',
  requests: [
    {
      id: 'request',
      principal: '10000',
      months: '3',
      date: '2026-01-31',
      terms,
    },
  ],
  loans: [
    {
      id: 'loan',
      request_id: 'request',
      date: '2026-01-31',
      calc_version: 'groups-loans-v1',
      schedule,
    },
  ],
  events: [
    {
      id: 'disbursal',
      revision: '1',
      loan_id: 'loan',
      kind: 'disbursement',
      principal: '-10000',
      interest: '0',
      cash: '-10000',
      allocations: [],
      reverses: null,
      journal_id: 'j1',
      journal: [
        { account: 'cash', side: 'credit', amount: '10000' },
        { account: 'loans_receivable', side: 'debit', amount: '10000' },
      ],
    },
  ],
};
test('API independently checks loan schedules, journals and repayment allocation', () => {
  assert.deepEqual(checkedLoanQuote(quote), quote);
  const checked = checkedLoans(book) as {
    loans: { principal_remaining: string; interest_remaining: string }[];
  };
  assert.equal(checked.loans[0]?.principal_remaining, '10000');
  assert.equal(checked.loans[0]?.interest_remaining, '500');
  assert.throws(() =>
    checkedLoanQuote({
      ...quote,
      schedule: [{ ...schedule[0], interest: '251' }, ...schedule.slice(1)],
    }),
  );
  const receipt = {
    id: 'receipt',
    revision: '2',
    loan_id: 'loan',
    kind: 'repayment',
    principal: '0',
    interest: '100',
    cash: '100',
    allocations: [{ period: '1', principal: '0', interest: '100' }],
    reverses: null,
    journal_id: 'j2',
    journal: [
      { account: 'cash', side: 'debit', amount: '100' },
      { account: 'interest_income', side: 'credit', amount: '100' },
    ],
  };
  assert.equal(
    (
      checkedLoans({ ...book, events: [...book.events, receipt] }) as {
        loans: { interest_remaining: string }[];
      }
    ).loans[0]?.interest_remaining,
    '400',
  );
  assert.throws(() =>
    checkedLoans({
      ...book,
      events: [
        ...book.events,
        {
          ...receipt,
          allocations: [{ period: '1', principal: '100', interest: '0' }],
        },
      ],
    }),
  );
  assert.throws(() =>
    checkedLoans({ ...book, events: [{ ...book.events[0], cash: '-9999' }] }),
  );
});
