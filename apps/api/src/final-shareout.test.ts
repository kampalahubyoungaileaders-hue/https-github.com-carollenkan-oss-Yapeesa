import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedFinalShareout } from './final-shareout.js';
const snapshot = {
  preview: {
    cycle_id: 'cycle',
    currency: 'UGX',
    fund: '100',
    total_shares: '1',
    calc_version: 'groups-shareout-preview-v1',
    scope: 'recorded-shares-only',
    loans_outstanding: '0',
    members: [{ id: 'a', name: 'Member', shares: '1', amount: '100' }],
  },
  cash: '125',
  social: '25',
  capital: '100',
  fines: '0',
  interest: '0',
  counted: '125',
};
const commit = [
  { account: 'share_capital', side: 'debit', amount: '100' },
  { account: 'shareout_payable', side: 'credit', amount: '100' },
];
const data = {
  currency: 'UGX',
  readiness: { snapshot: null, blockers: [] },
  plan: {
    id: 'plan',
    cycle_id: 'cycle',
    calc_version: 'groups-final-shareout-v1',
    snapshot,
    committed: true,
    finalized: false,
    approvals: [{ officer_id: 'o1' }, { officer_id: 'o2' }],
    commit_journal: commit,
    allocations: [
      {
        id: 'allocation',
        member_id: 'a',
        shares: '1',
        amount: '100',
        receipt: null as null | object,
      },
    ],
  },
};
test('API independently checks approved allocations, source fund, payable and payout journals', () => {
  assert.deepEqual(checkedFinalShareout(data), data);
  const paid = structuredClone(data);
  paid.plan.allocations[0]!.receipt = {
    id: 'r',
    amount: '100',
    journal_id: 'j',
    journal: [
      { account: 'cash', side: 'credit', amount: '100' },
      { account: 'shareout_payable', side: 'debit', amount: '100' },
    ],
  };
  paid.plan.finalized = true;
  assert.deepEqual(checkedFinalShareout(paid), paid);
  for (const mutate of [
    (d: typeof data) => {
      d.plan.snapshot.social = '24';
    },
    (d: typeof data) => {
      d.plan.snapshot.counted = '124';
    },
    (d: typeof data) => {
      d.plan.approvals[1]!.officer_id = 'o1';
    },
    (d: typeof data) => {
      d.plan.commit_journal[0]!.side = 'credit';
    },
    (d: typeof data) => {
      d.plan.allocations[0]!.amount = '99';
    },
    (d: typeof data) => {
      d.plan.finalized = true;
    },
    (d: typeof data) => {
      d.plan.allocations = [];
    },
    (d: typeof data) => {
      d.plan.snapshot.preview.loans_outstanding = '1';
    },
  ]) {
    const d = structuredClone(data);
    mutate(d);
    assert.throws(() => checkedFinalShareout(d));
  }
  const bad = structuredClone(paid);
  (bad.plan.allocations[0]!.receipt as { amount: string }).amount = '99';
  assert.throws(() => checkedFinalShareout(bad));
});
