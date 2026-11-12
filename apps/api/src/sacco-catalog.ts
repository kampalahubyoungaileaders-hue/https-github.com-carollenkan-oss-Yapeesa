import {
  saccoFieldLabels,
  saccoOperationLabels,
  saccoResourceLabels,
} from '@yapesa/i18n';
import { ApiError } from './backend.js';
export type SaccoField = {
  key: string;
  label: string;
  type: 'text' | 'id' | 'decimal' | 'integer' | 'date' | 'boolean';
  required: boolean;
};
export type SaccoOperation = {
  id: string;
  label: string;
  resource: string;
  roles: string[];
  method: 'POST' | 'PUT';
  path: string;
  permission: string;
  fields: SaccoField[];
  target: boolean;
  subTarget?: boolean;
  checker?: boolean;
  quote?: boolean;
};
const staff = [
    'manager',
    'accountant',
    'loan_officer',
    'teller',
    'field_officer',
  ],
  managers = ['manager'],
  accounts = ['manager', 'accountant'],
  cash = ['manager', 'teller'],
  lending = ['manager', 'loan_officer'];
function fields(spec: string): SaccoField[] {
  return spec
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      const [raw, type = 'text'] = token.split(':');
      const optional = raw!.endsWith('?'),
        key = optional ? raw!.slice(0, -1) : raw!;
      if (!saccoFieldLabels[key])
        throw new Error(`Missing SACCO field label: ${key}`);
      return {
        key,
        label: saccoFieldLabels[key]!,
        type: type as SaccoField['type'],
        required: !optional,
      };
    });
}
const op = (
  id: string,
  label: string,
  resource: string,
  roles: string[],
  path: string,
  permission: string,
  spec: string,
  target = false,
  extra: Partial<SaccoOperation> = {},
): SaccoOperation => ({
  id,
  label,
  resource,
  roles,
  method: 'POST',
  path,
  permission,
  fields: fields(spec),
  target,
  ...extra,
});
const dayNote = 'note?';
export const saccoOperations: SaccoOperation[] = [
  op(
    'member.create',
    saccoOperationLabels['member.create']!,
    'members',
    staff,
    'clients',
    'CREATE_CLIENT',
    'officeId:id firstname lastname externalId? mobileNo? dateOfBirth?:date submittedOnDate:date',
  ),
  op(
    'member.activate',
    saccoOperationLabels['member.activate']!,
    'members',
    managers,
    'clients/{id}?command=activate',
    'ACTIVATE_CLIENT',
    'activationDate:date',
    true,
  ),
  op(
    'member.identifier',
    saccoOperationLabels['member.identifier']!,
    'members',
    staff,
    'clients/{id}/identifiers',
    'CREATE_CLIENTIDENTIFIER',
    'documentTypeId:id documentKey status',
    true,
  ),
  op(
    'savings.apply',
    saccoOperationLabels['savings.apply']!,
    'savings',
    staff,
    'savingsaccounts',
    'CREATE_SAVINGSACCOUNT',
    'clientId:id productId:id submittedOnDate:date fieldOfficerId?:id externalId?',
  ),
  op(
    'savings.approve',
    saccoOperationLabels['savings.approve']!,
    'savings',
    managers,
    'savingsaccounts/{id}?command=approve',
    'APPROVE_SAVINGSACCOUNT',
    `approvedOnDate:date ${dayNote}`,
    true,
  ),
  op(
    'savings.activate',
    saccoOperationLabels['savings.activate']!,
    'savings',
    managers,
    'savingsaccounts/{id}?command=activate',
    'ACTIVATE_SAVINGSACCOUNT',
    `activatedOnDate:date ${dayNote}`,
    true,
  ),
  op(
    'savings.deposit',
    saccoOperationLabels['savings.deposit']!,
    'savings',
    cash,
    'savingsaccounts/{id}/transactions?command=deposit',
    'DEPOSIT_SAVINGSACCOUNT',
    `transactionDate:date transactionAmount:decimal paymentTypeId:id ${dayNote}`,
    true,
  ),
  op(
    'savings.withdraw',
    saccoOperationLabels['savings.withdraw']!,
    'savings',
    cash,
    'savingsaccounts/{id}/transactions?command=withdrawal',
    'WITHDRAWAL_SAVINGSACCOUNT',
    `transactionDate:date transactionAmount:decimal paymentTypeId:id ${dayNote}`,
    true,
  ),
  op(
    'savings.interest.calculate',
    saccoOperationLabels['savings.interest.calculate']!,
    'savings',
    accounts,
    'savingsaccounts/{id}?command=calculateInterest',
    'CALCULATEINTEREST_SAVINGSACCOUNT',
    '',
    true,
  ),
  op(
    'savings.interest.post',
    saccoOperationLabels['savings.interest.post']!,
    'savings',
    accounts,
    'savingsaccounts/{id}?command=postInterest',
    'POSTINTEREST_SAVINGSACCOUNT',
    '',
    true,
  ),
  op(
    'savings.undo',
    saccoOperationLabels['savings.undo']!,
    'savings',
    managers,
    'savingsaccounts/{id}/transactions/{subId}?command=undo',
    'UNDOTRANSACTION_SAVINGSACCOUNT',
    'note',
    true,
    { subTarget: true },
  ),
  op(
    'savings.close',
    saccoOperationLabels['savings.close']!,
    'savings',
    managers,
    'savingsaccounts/{id}?command=close',
    'CLOSE_SAVINGSACCOUNT',
    `closedOnDate:date ${dayNote}`,
    true,
  ),
  op(
    'share.apply',
    saccoOperationLabels['share.apply']!,
    'shares',
    staff,
    'accounts/share',
    'CREATE_SHAREACCOUNT',
    'clientId:id productId:id savingsAccountId:id submittedDate:date applicationDate:date requestedShares:integer externalId?',
  ),
  op(
    'share.approve',
    saccoOperationLabels['share.approve']!,
    'shares',
    managers,
    'accounts/share/{id}?command=approve',
    'APPROVE_SHAREACCOUNT',
    `approvedDate:date ${dayNote}`,
    true,
  ),
  op(
    'share.activate',
    saccoOperationLabels['share.activate']!,
    'shares',
    managers,
    'accounts/share/{id}?command=activate',
    'ACTIVATE_SHAREACCOUNT',
    'activatedDate:date',
    true,
  ),
  op(
    'share.purchase',
    saccoOperationLabels['share.purchase']!,
    'shares',
    cash,
    'accounts/share/{id}?command=applyadditionalshares',
    'APPLYADDITIONALSHARES_SHAREACCOUNT',
    'requestedDate:date requestedShares:integer',
    true,
  ),
  op(
    'share.redeem',
    saccoOperationLabels['share.redeem']!,
    'shares',
    cash,
    'accounts/share/{id}?command=redeemshares',
    'REDEEMSHARES_SHAREACCOUNT',
    'requestedDate:date requestedShares:integer',
    true,
  ),
  op(
    'dividend.declare',
    saccoOperationLabels['dividend.declare']!,
    'share-products',
    accounts,
    'shareproduct/{id}/dividend',
    'CREATE_DIVIDEND_SHAREPRODUCT',
    'dividendPeriodStartDate:date dividendPeriodEndDate:date dividendAmount:decimal',
    true,
  ),
  op(
    'dividend.approve',
    saccoOperationLabels['dividend.approve']!,
    'share-products',
    managers,
    'shareproduct/{id}/dividend/{subId}?command=approve',
    'APPROVE_DIVIDEND_SHAREPRODUCT',
    '',
    true,
    { subTarget: true, method: 'PUT' },
  ),
  op(
    'loan.apply',
    saccoOperationLabels['loan.apply']!,
    'loans',
    lending,
    'loans',
    'CREATE_LOAN',
    'clientId:id productId:id principal:decimal loanTermFrequency:integer loanTermFrequencyType:integer numberOfRepayments:integer repaymentEvery:integer repaymentFrequencyType:integer interestRatePerPeriod:decimal amortizationType:integer interestType:integer interestCalculationPeriodType:integer transactionProcessingStrategyCode expectedDisbursementDate:date submittedOnDate:date repaymentsStartingFromDate?:date externalId?',
  ),
  op(
    'loan.quote',
    saccoOperationLabels['loan.quote']!,
    'loans',
    lending,
    'loans?command=calculateLoanSchedule',
    'READ_LOAN',
    'clientId:id productId:id principal:decimal loanTermFrequency:integer loanTermFrequencyType:integer numberOfRepayments:integer repaymentEvery:integer repaymentFrequencyType:integer interestRatePerPeriod:decimal amortizationType:integer interestType:integer interestCalculationPeriodType:integer transactionProcessingStrategyCode expectedDisbursementDate:date submittedOnDate:date',
    false,
    { quote: true },
  ),
  op(
    'loan.approve',
    saccoOperationLabels['loan.approve']!,
    'loans',
    managers,
    'loans/{id}?command=approve',
    'APPROVE_LOAN',
    `approvedOnDate:date ${dayNote}`,
    true,
  ),
  op(
    'loan.disburse',
    saccoOperationLabels['loan.disburse']!,
    'loans',
    cash,
    'loans/{id}?command=disburse',
    'DISBURSE_LOAN',
    `actualDisbursementDate:date paymentTypeId?:id ${dayNote}`,
    true,
  ),
  op(
    'loan.repay',
    saccoOperationLabels['loan.repay']!,
    'loans',
    cash,
    'loans/{id}/transactions?command=repayment',
    'REPAYMENT_LOAN',
    `transactionDate:date transactionAmount:decimal paymentTypeId:id ${dayNote}`,
    true,
  ),
  op(
    'loan.guarantor',
    saccoOperationLabels['loan.guarantor']!,
    'loans',
    lending,
    'loans/{id}/guarantors',
    'CREATE_GUARANTOR',
    'guarantorTypeId:integer entityId:id relationshipTypeId?:id',
    true,
  ),
  op(
    'loan.writeoff',
    saccoOperationLabels['loan.writeoff']!,
    'loans',
    managers,
    'loans/{id}/transactions?command=writeoff',
    'WRITEOFF_LOAN',
    `transactionDate:date note`,
    true,
  ),
  op(
    'closure.create',
    saccoOperationLabels['closure.create']!,
    'closures',
    accounts,
    'glclosures',
    'CREATE_GLCLOSURE',
    'officeId:id closingDate:date comments',
  ),
  op(
    'checker.approve',
    saccoOperationLabels['checker.approve']!,
    'approvals',
    managers,
    'makercheckers/{id}?command=approve',
    'CHECKER',
    '',
    true,
    { checker: true },
  ),
  op(
    'checker.reject',
    saccoOperationLabels['checker.reject']!,
    'approvals',
    managers,
    'makercheckers/{id}?command=reject',
    'CHECKER',
    '',
    true,
    { checker: true },
  ),
];
export const saccoResources: Record<
  string,
  {
    label: string;
    path: string;
    roles: string[];
    detail?: string;
    template?: string;
    page?: boolean;
  }
> = {
  members: {
    label: saccoResourceLabels['members']!,
    path: 'clients',
    roles: staff,
    detail: 'clients/{id}?associations=all',
    template: 'clients/template',
    page: true,
  },
  savings: {
    label: saccoResourceLabels['savings']!,
    path: 'savingsaccounts',
    roles: staff,
    detail: 'savingsaccounts/{id}?associations=all',
    template: 'savingsaccounts/template',
    page: true,
  },
  shares: {
    label: saccoResourceLabels['shares']!,
    path: 'accounts/share',
    roles: staff,
    detail: 'accounts/share/{id}',
    template: 'accounts/share/template',
    page: true,
  },
  loans: {
    label: saccoResourceLabels['loans']!,
    path: 'loans',
    roles: staff,
    detail: 'loans/{id}?associations=all',
    template: 'loans/template?templateType=individual',
    page: true,
  },
  'savings-products': {
    label: saccoResourceLabels['savings-products']!,
    path: 'savingsproducts',
    roles: staff,
    detail: 'savingsproducts/{id}',
    template: 'savingsproducts/template',
  },
  'share-products': {
    label: saccoResourceLabels['share-products']!,
    path: 'products/share',
    roles: staff,
    detail: 'products/share/{id}',
    template: 'products/share/template',
    page: true,
  },
  'loan-products': {
    label: saccoResourceLabels['loan-products']!,
    path: 'loanproducts',
    roles: staff,
    detail: 'loanproducts/{id}',
    template: 'loanproducts/template',
  },
  branches: {
    label: saccoResourceLabels['branches']!,
    path: 'offices',
    roles: staff,
  },
  tellers: {
    label: saccoResourceLabels['tellers']!,
    path: 'tellers',
    roles: cash,
    detail: 'tellers/{id}',
  },
  'ledger-accounts': {
    label: saccoResourceLabels['ledger-accounts']!,
    path: 'glaccounts',
    roles: accounts,
    detail: 'glaccounts/{id}',
  },
  journals: {
    label: saccoResourceLabels['journals']!,
    path: 'journalentries',
    roles: accounts,
    page: true,
  },
  closures: {
    label: saccoResourceLabels['closures']!,
    path: 'glclosures',
    roles: accounts,
    detail: 'glclosures/{id}',
  },
  approvals: {
    label: saccoResourceLabels['approvals']!,
    path: 'makercheckers?includeJson=true',
    roles: managers,
    detail: 'makercheckers/{id}',
  },
  reports: {
    label: saccoResourceLabels['reports']!,
    path: 'reports?fields=id,reportName,reportType,reportCategory,description,reportParameters',
    roles: accounts,
  },
};
export function saccoPayload(
  operation: SaccoOperation,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (
    Object.keys(input).some(
      (key) => !operation.fields.some((f) => f.key === key),
    )
  )
    throw new ApiError(400, 'INVALID_SACCO_FIELDS');
  const result: Record<string, unknown> = {};
  for (const field of operation.fields) {
    const value = input[field.key];
    if (value === undefined || value === '') {
      if (field.required) throw new ApiError(400, 'INVALID_SACCO_FIELDS');
      continue;
    }
    if (typeof value !== 'string' || value.length > 500)
      throw new ApiError(400, 'INVALID_SACCO_FIELDS');
    if (
      field.type === 'date' &&
      (!/^20\d{2}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(new Date(value + 'T00:00:00Z').getTime()))
    )
      throw new ApiError(400, 'INVALID_SACCO_FIELDS');
    if (
      (field.type === 'id' && !/^[1-9]\d{0,18}$/.test(value)) ||
      (field.type === 'integer' && !/^(?:0|[1-9]\d{0,9})$/.test(value)) ||
      (field.type === 'decimal' &&
        !/^(?:0|[1-9]\d{0,18})(?:\.\d{1,8})?$/.test(value)) ||
      (field.type === 'date' &&
        (!/^20\d{2}-\d{2}-\d{2}$/.test(value) ||
          new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !==
            value)) ||
      (field.type === 'boolean' && !['true', 'false'].includes(value))
    )
      throw new ApiError(400, 'INVALID_SACCO_FIELDS');
    result[field.key] = field.type === 'boolean' ? value === 'true' : value;
  }
  if (operation.fields.some((f) => f.type === 'date'))
    result['dateFormat'] = 'yyyy-MM-dd';
  result['locale'] = 'en';
  if (
    operation.id.startsWith('loan.') &&
    ['loan.apply', 'loan.quote'].includes(operation.id)
  )
    result['loanType'] = 'individual';
  if (operation.id === 'member.create') {
    result['active'] = false;
    // This workflow creates individual members, never corporate clients.
    result['legalFormId'] = '1';
  }
  if (operation.checker) return {};
  return result;
}
