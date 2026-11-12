import test from 'node:test';
import assert from 'node:assert/strict';
import {
  independentCommand,
  independentOperations,
  independentFingerprint,
} from './sacco-approval.js';
const input = {
  operation: 'share.apply',
  values: {
    clientId: '1',
    productId: '2',
    savingsAccountId: '3',
    submittedDate: '2026-11-01',
    applicationDate: '2026-11-01',
    requestedShares: '10',
  },
};
test('independent approval accepts only reviewed operations, roles, native permissions and exact fields', () => {
  const result = independentCommand(input, ['teller'], ['CREATE_SHAREACCOUNT']);
  assert.equal(result.path, 'accounts/share');
  assert.equal(result.body['requestedShares'], '10');
  for (const [command, roles, permissions] of [
    [
      { ...input, operation: 'savings.deposit' },
      ['teller'],
      ['DEPOSIT_SAVINGSACCOUNT'],
    ],
    [input, ['member'], ['CREATE_SHAREACCOUNT']],
    [input, ['teller'], []],
    [{ ...input, record: '../users' }, ['teller'], ['CREATE_SHAREACCOUNT']],
    [
      { ...input, values: { ...input.values, username: 'forbidden' } },
      ['teller'],
      ['CREATE_SHAREACCOUNT'],
    ],
  ] as const)
    assert.throws(() =>
      independentCommand(command, [...roles], [...permissions]),
    );
  assert(!independentOperations.has('checker.approve'));
  assert(!independentOperations.has('loan.disburse'));
});
test('approved dividend command binds both native resource IDs and PUT', () => {
  const result = independentCommand(
    {
      operation: 'dividend.approve',
      record: '12',
      sub_record: '34',
      values: {},
    },
    ['manager'],
    ['APPROVE_DIVIDEND_SHAREPRODUCT'],
  );
  assert.equal(result.operation.method, 'PUT');
  assert.equal(result.path, 'shareproduct/12/dividend/34?command=approve');
  assert.throws(() =>
    independentCommand(
      {
        operation: 'dividend.approve',
        record: '12',
        sub_record: '../34',
        values: {},
      },
      ['manager'],
      ['APPROVE_DIVIDEND_SHAREPRODUCT'],
    ),
  );
});

test('native command fingerprint binds method, path and exact monetary inputs', () => {
  const a = independentCommand(input, ['teller'], ['CREATE_SHAREACCOUNT']);
  const b = independentCommand(
    { ...input, values: { ...input.values, requestedShares: '11' } },
    ['teller'],
    ['CREATE_SHAREACCOUNT'],
  );
  assert.notEqual(independentFingerprint(a), independentFingerprint(b));
  assert.notEqual(
    independentFingerprint(a),
    independentFingerprint({ ...a, path: a.path + '/1' }),
  );
  assert.notEqual(
    independentFingerprint(a),
    independentFingerprint({
      ...a,
      operation: { ...a.operation, method: 'PUT' },
    }),
  );
  assert.equal(
    independentFingerprint(a),
    independentFingerprint(
      independentCommand(input, ['teller'], ['CREATE_SHAREACCOUNT']),
    ),
  );
});
