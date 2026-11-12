import manifest from '../../../infra/templates/lender-v1.json' with { type: 'json' };
import { fineractMinor } from './fineract.js';
export { manifest as lenderTemplate };
export interface LenderTerms {
  currencyCode: string;
  digitsAfterDecimal: string;
  inMultiplesOf: string;
  principal: string;
  numberOfRepayments: string;
  repaymentEvery: string;
  repaymentFrequencyType: string;
  interestRatePerPeriod: string;
  interestRateFrequencyType: string;
  amortizationType: string;
  interestCalculationPeriodType: string;
  transactionProcessingStrategyCode: string;
  daysInMonthType: string;
  daysInYearType: string;
  accountingRule: '2';
  isInterestRecalculationEnabled: false;
  charges: readonly string[];
}
const integerFields = [
  'inMultiplesOf',
  'numberOfRepayments',
  'repaymentEvery',
  'repaymentFrequencyType',
  'interestRateFrequencyType',
  'amortizationType',
  'interestCalculationPeriodType',
  'daysInMonthType',
  'daysInYearType',
] as const;
const otherFields = [
  'currencyCode',
  'digitsAfterDecimal',
  'principal',
  'interestRatePerPeriod',
  'transactionProcessingStrategyCode',
  'accountingRule',
  'isInterestRecalculationEnabled',
  'charges',
] as const;
export function lenderProduct(
  key: 'flat' | 'declining',
  terms: LenderTerms,
  accounts: Record<string, string>,
) {
  const product = manifest.products.find((p) => p.key === key);
  if (
    !product ||
    !terms ||
    Object.keys(terms).length !== integerFields.length + otherFields.length ||
    Object.keys(terms).some(
      (k) =>
        ![...integerFields, ...otherFields].includes(
          k as (typeof otherFields)[number],
        ),
    )
  )
    throw new Error('INVALID_LENDER_TERMS');
  if (
    typeof terms.currencyCode !== 'string' ||
    !/^[A-Z]{3}$/.test(terms.currencyCode) ||
    typeof terms.digitsAfterDecimal !== 'string' ||
    !/^[0-6]$/.test(terms.digitsAfterDecimal) ||
    terms.accountingRule !== '2' ||
    terms.isInterestRecalculationEnabled !== false ||
    !Array.isArray(terms.charges) ||
    terms.charges.some(
      (id) => typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id),
    ) ||
    new Set(terms.charges).size !== terms.charges.length
  )
    throw new Error('INVALID_LENDER_TERMS');
  for (const field of integerFields)
    if (
      typeof terms[field] !== 'string' ||
      !/^(0|[1-9]\d{0,8})$/.test(terms[field])
    )
      throw new Error('INVALID_LENDER_TERMS');
  for (const field of ['principal', 'interestRatePerPeriod'] as const)
    if (
      typeof terms[field] !== 'string' ||
      !/^(0|[1-9]\d{0,18})(?:\.\d{1,8})?$/.test(terms[field])
    )
      throw new Error('INVALID_LENDER_TERMS');
  if (
    BigInt(fineractMinor(terms.principal, Number(terms.digitsAfterDecimal))) <=
      0n ||
    terms.numberOfRepayments === '0' ||
    terms.repaymentEvery === '0' ||
    typeof terms.transactionProcessingStrategyCode !== 'string' ||
    !/^[a-z][a-z0-9-]{0,99}$/.test(terms.transactionProcessingStrategyCode)
  )
    throw new Error('INVALID_LENDER_TERMS');
  for (const { key } of manifest.accounts)
    if (
      typeof accounts[key] !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(accounts[key] ?? '')
    )
      throw new Error('INVALID_LENDER_ACCOUNTS');
  if (
    new Set(manifest.accounts.map(({ key }) => accounts[key])).size !==
    manifest.accounts.length
  )
    throw new Error('INVALID_LENDER_ACCOUNTS');
  return {
    ...terms,
    charges: terms.charges.map((id) => ({ id })),
    name: product.name,
    shortName: product.shortName,
    interestType: product.interestType,
    locale: 'en',
    fundSourceAccountId: accounts['cash'],
    loanPortfolioAccountId: accounts['portfolio'],
    transfersInSuspenseAccountId: accounts['suspense'],
    interestOnLoanAccountId: accounts['interest'],
    incomeFromFeeAccountId: accounts['fees'],
    incomeFromPenaltyAccountId: accounts['penalties'],
    incomeFromRecoveryAccountId: accounts['recovery'],
    writeOffAccountId: accounts['expense'],
    overpaymentLiabilityAccountId: accounts['overpayment'],
    goodwillCreditAccountId: accounts['expense'],
    chargeOffExpenseAccountId: accounts['expense'],
    chargeOffFraudExpenseAccountId: accounts['expense'],
    incomeFromChargeOffInterestAccountId: accounts['interest'],
    incomeFromChargeOffFeesAccountId: accounts['fees'],
    incomeFromChargeOffPenaltyAccountId: accounts['penalties'],
    incomeFromGoodwillCreditInterestAccountId: accounts['interest'],
    incomeFromGoodwillCreditFeesAccountId: accounts['fees'],
    incomeFromGoodwillCreditPenaltyAccountId: accounts['penalties'],
  };
}
