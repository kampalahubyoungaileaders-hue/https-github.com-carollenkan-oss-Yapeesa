import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lenderProduct,
  lenderTemplate,
  type LenderTerms,
} from './lender-template.js';
const terms: LenderTerms = {
  currencyCode: 'UGX',
  digitsAfterDecimal: '0',
  inMultiplesOf: '0',
  principal: '9007199254740993',
  numberOfRepayments: '1',
  repaymentEvery: '1',
  repaymentFrequencyType: '2',
  interestRatePerPeriod: '1',
  interestRateFrequencyType: '2',
  amortizationType: '1',
  interestCalculationPeriodType: '1',
  transactionProcessingStrategyCode: 'mifos-standard-strategy',
  daysInMonthType: '1',
  daysInYearType: '1',
  accountingRule: '2',
  isInterestRecalculationEnabled: false,
  charges: [],
};
const accounts = Object.fromEntries(
  lenderTemplate.accounts.map(({ key }, index) => [key, String(index + 1)]),
);
test('lender template preserves explicit terms and separates principal from suspense', () => {
  const flat = lenderProduct('flat', terms, accounts),
    declining = lenderProduct('declining', terms, accounts);
  assert.equal(flat.principal, '9007199254740993');
  assert.equal(flat.interestType, '1');
  assert.equal(declining.interestType, '0');
  assert.notEqual(
    flat.loanPortfolioAccountId,
    flat.transfersInSuspenseAccountId,
  );
  assert.equal(
    lenderTemplate.accounts.find((a) => a.key === 'suspense')?.type,
    '1',
  );
  assert.deepEqual(flat.charges, []);
});
test('lender products reject missing terms, numeric money, fractional minor units and mapping injection', () => {
  const missing = { ...terms } as Partial<LenderTerms>;
  delete missing.interestRatePerPeriod;
  for (const input of [
    missing,
    { ...terms, principal: 9007199254740992 },
    { ...terms, principal: '1.5' },
    { ...terms, digitsAfterDecimal: 0 },
    { ...terms, fundSourceAccountId: '99' },
    { ...terms, charges: [1] },
  ])
    assert.throws(() => lenderProduct('flat', input as LenderTerms, accounts));
  assert.throws(() =>
    lenderProduct('flat', terms, {
      ...accounts,
      suspense: accounts['portfolio']!,
    }),
  );
});
test('lender role template has independent checkers and no blanket financial authority', () => {
  for (const role of lenderTemplate.roles)
    assert(!role.permissions.some((p) => p.startsWith('ALL_FUNCTIONS')));
  const officer = lenderTemplate.roles.find((r) => r.key === 'loan_officer')!;
  const manager = lenderTemplate.roles.find((r) => r.key === 'manager')!;
  assert(!officer.permissions.some((p) => p.endsWith('_CHECKER')));
  for (const code of lenderTemplate.nativeCheckedActions)
    assert(manager.permissions.includes(code + '_CHECKER'));
});
