import test from 'node:test';
import assert from 'node:assert/strict';
import { saccoDividendRecord } from './sacco-dividends.js';

test('native dividend allocations require a matching parent and use bounded pages', async () => {
  const requests: string[] = [];
  const result = await saccoDividendRecord(
    async (path) => {
      requests.push(path);
      return path.includes('/dividend?')
        ? { totalFilteredRecords: '1', pageItems: [{ id: '9007199254740993' }] }
        : {
            totalFilteredRecords: '51',
            pageItems: [{ savingsTransactionId: '9007199254740995' }],
          };
    },
    '42',
    '9007199254740993',
    '50',
  );
  assert.deepEqual(requests, [
    'shareproduct/42/dividend?limit=1000&offset=0',
    'shareproduct/42/dividend/9007199254740993?limit=50&offset=50',
  ]);
  assert.deepEqual(result, {
    totalFilteredRecords: '51',
    pageItems: [{ savingsTransactionId: '9007199254740995' }],
  });
});
test('a dividend from another product is rejected before native allocation lookup', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      saccoDividendRecord(
        async () => {
          calls++;
          return { totalFilteredRecords: '1', pageItems: [{ id: '8' }] };
        },
        '42',
        '7',
      ),
    { code: 'SACCO_DIVIDEND_NOT_AVAILABLE' },
  );
  assert.equal(calls, 1);
});
test('a truncated parent list cannot be treated as proof of absence', async () => {
  await assert.rejects(
    () =>
      saccoDividendRecord(
        async () => ({
          totalFilteredRecords: '1001',
          pageItems: [{ id: '8' }],
        }),
        '42',
        '7',
      ),
    { code: 'SACCO_DIVIDEND_LOOKUP_LIMIT' },
  );
});
test('invalid parent IDs, dividend IDs and offsets fail before native I/O', async () => {
  for (const args of [
    ['../42', '7', '0'],
    ['42', '7?command=approve', '0'],
    ['42', '7', '-1'],
  ] as const)
    await assert.rejects(
      () =>
        saccoDividendRecord(
          async () => {
            assert.fail('No I/O');
          },
          args[0],
          args[1],
          args[2],
        ),
      { code: 'INVALID_SACCO_REFERENCE' },
    );
});
