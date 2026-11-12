import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { v7 } from 'uuid';
import { Fineract, fineractMinor } from '../apps/api/src/fineract.ts';
import { buildApp } from '../apps/api/src/app.ts';
import { readConfig } from '../apps/api/src/config.ts';
import { localStaffPassword } from './fineract-test-credentials.mjs';
import { totp } from './totp.ts';
assert.equal(
  process.env.FINERACT_LOCAL_SACCO_PROOF,
  '1',
  'Explicit disposable financial proof required',
);
const config = readConfig();
assert(config);
for (const url of [config.supabaseUrl, process.env.TEST_DB_URL])
  assert(
    ['localhost', '127.0.0.1'].includes(new URL(url).hostname),
    'Disposable local identities only',
  );
const endpoint = {
  url: 'https://127.0.0.1:8443/fineract-provider/api/v1/',
  localTest: true,
};
const bootstrap = {
  username: process.env.FINERACT_LOCAL_ADMIN_USER ?? 'mifos',
  password: process.env.FINERACT_LOCAL_ADMIN_PASSWORD ?? 'password',
};
const root = new Fineract(endpoint, 'default', bootstrap),
  prefix = `yp_sc_${randomBytes(5).toString('hex')}`;
config.fineractInstances = { local_sacco: endpoint };
const app = buildApp(config),
  cookies = new Map();
let stage = 'setup',
  oldConfiguration,
  oldPermissionSettings,
  oldPostingJob;
const iso = (days) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  },
  start = iso(-60),
  today = iso(0);
const scalarId = (result) => {
  assert(
    result &&
      typeof result.resourceId === 'string' &&
      /^[1-9]\d*$/.test(result.resourceId),
  );
  return result.resourceId;
};
async function native(actor, method, path, body) {
  try {
    return await actor.request(method, path, body);
  } catch (error) {
    throw new Error(
      `Native contract failed at ${stage}: ${method} ${path.split('?')[0]} ${error.code ?? 'FAILED'} fields=${error.fields?.join(',') ?? ''}`,
      { cause: error },
    );
  }
}
async function call(label, method, url, payload) {
  // Respect the production 30/minute command limit; never retry a write.
  if (method === 'POST' && url.endsWith('/commands'))
    await new Promise((resolve) => setTimeout(resolve, 2100));
  const r = await app.inject({
    method,
    url,
    headers: {
      origin: config.webOrigin,
      ...(cookies.has(label) ? { cookie: cookies.get(label) } : {}),
    },
    ...(payload ? { payload } : {}),
    remoteAddress: `127.0.2.${{ root: 101, maker: 102, checker: 103 }[label]}`,
  });
  for (const c of r.cookies)
    if (c.name === 'yapesa_session') cookies.set(label, `${c.name}=${c.value}`);
  return r;
}
async function ok(label, method, url, payload) {
  const r = await call(label, method, url, payload);
  if (r.statusCode !== 200) {
    const e = r.json();
    throw new Error(
      `SACCO contract failed at ${stage}: ${method} ${url.split('?')[0]} ${r.statusCode} ${e.error} fields=${e.fields?.join(',') ?? ''}`,
    );
  }
  return r.json();
}
async function login(label, fixture) {
  await ok(label, 'POST', '/api/auth/login', {
    phone: process.env[`TEST_${fixture}_PHONE`],
    pin: process.env.TEST_PIN,
  });
  await ok(label, 'POST', '/api/auth/mfa/verify', {
    factor_id: process.env[`TEST_${fixture}_FACTOR`],
    code: totp(process.env[`TEST_${fixture}_TOTP`]),
  });
}
let org;
const setup = (action, extra) =>
  ok('root', 'POST', '/api/admin/saccos', {
    request_id: v7(),
    device_id: v7(),
    action,
    reason: 'Disposable native SACCO acceptance',
    ...extra,
  });
async function queue(label = 'checker') {
  const result = await ok(label, 'GET', `/api/saccos/${org}/records/approvals`);
  return result.pageItems;
}
async function submit(operation, values = {}, record, subRecord) {
  const command = {
    request_id: v7(),
    operation,
    values,
    ...(record ? { record } : {}),
    ...(subRecord ? { sub_record: subRecord } : {}),
  };
  const result = await ok(
    'maker',
    'POST',
    `/api/saccos/${org}/commands`,
    command,
  );
  assert(['succeeded', 'awaiting_approval'].includes(result.status));
  if (result.status === 'succeeded') assert(result.result.command_id);
  return { command, result };
}
async function check(pending) {
  if (pending.result.status === 'awaiting_approval') {
    const proposal = pending.result.id;
    const hash = pending.result.result.review_hash;
    const self = await call('maker', 'POST', `/api/saccos/${org}/commands`, {
      request_id: v7(),
      operation: 'checker.approve',
      record: proposal,
      review_hash: hash,
      values: {},
    });
    assert.equal(self.statusCode, 403);
    const approved = await ok(
      'checker',
      'POST',
      `/api/saccos/${org}/commands`,
      {
        request_id: v7(),
        operation: 'checker.approve',
        record: proposal,
        review_hash: hash,
        values: {},
      },
    );
    assert.equal(approved.status, 'approved');
    const command = {
      request_id: v7(),
      operation: 'approval.execute',
      record: proposal,
      review_hash: hash,
      values: {},
    };
    const executed = await ok(
      'maker',
      'POST',
      `/api/saccos/${org}/commands`,
      command,
    );
    assert.equal(executed.status, 'succeeded');
    assert.deepEqual(
      await ok('maker', 'POST', `/api/saccos/${org}/commands`, command),
      executed,
    );
    return executed.result.resource_id;
  }

  const commandId = pending.result.result.command_id;
  const own = (await queue('maker')).find((row) => row.id === commandId);
  if (own) assert(!own.can_check, 'Requester must not check own command');
  const denied = await call('maker', 'POST', `/api/saccos/${org}/commands`, {
    request_id: v7(),
    operation: 'checker.approve',
    record: commandId,
    review_hash:
      own?.review_hash ??
      (await queue()).find((row) => row.id === commandId)?.review_hash,
    values: {},
  });
  assert([403, 409].includes(denied.statusCode), 'Self-check must fail');
  const item = (await queue()).find((row) => row.id === commandId);
  assert(
    item?.can_check,
    'Independent checker must see the exact recorded command',
  );
  const result = await ok('checker', 'POST', `/api/saccos/${org}/commands`, {
    request_id: v7(),
    operation: 'checker.approve',
    record: commandId,
    review_hash: item.review_hash,
    values: {},
  });
  assert.equal(result.status, 'succeeded');
  return result.result.resource_id;
}
async function execute(operation, values = {}, record) {
  return check(await submit(operation, values, record));
}
try {
  stage = 'clean disposable engine';
  const journals = await native(root, 'GET', 'journalentries?limit=1&offset=0');
  assert.equal(
    journals.totalFilteredRecords,
    '0',
    'Refuse to mix fixtures into an engine with financial records',
  );
  const offices = await native(root, 'GET', 'offices'),
    office = offices[0].id;
  const configuration = await native(root, 'GET', 'configurations');
  oldConfiguration = configuration.globalConfiguration.find(
    (c) => c.name === 'maker-checker',
  );
  assert(oldConfiguration);
  const policies = await native(
    root,
    'GET',
    'permissions?makerCheckerable=true',
  );
  oldPermissionSettings = Object.fromEntries(
    policies.map((p) => [p.code, p.selected]),
  );
  const allPermissions = await native(root, 'GET', 'permissions'),
    available = new Set(allPermissions.map((p) => p.code));
  const actions = [
    'CREATE_CLIENT',
    'ACTIVATE_CLIENT',
    'CREATE_SAVINGSACCOUNT',
    'APPROVE_SAVINGSACCOUNT',
    'ACTIVATE_SAVINGSACCOUNT',
    'DEPOSIT_SAVINGSACCOUNT',
    'WITHDRAWAL_SAVINGSACCOUNT',
    'CREATE_SHAREACCOUNT',
    'APPROVE_SHAREACCOUNT',
    'ACTIVATE_SHAREACCOUNT',
    'CREATE_DIVIDEND_SHAREPRODUCT',
    'APPROVE_DIVIDEND_SHAREPRODUCT',
    'CREATE_LOAN',
    'APPROVE_LOAN',
    'DISBURSE_LOAN',
    'REPAYMENT_LOAN',
  ];
  const independent = new Set([
    'CREATE_SHAREACCOUNT',
    'APPROVE_SHAREACCOUNT',
    'ACTIVATE_SHAREACCOUNT',
    'CREATE_DIVIDEND_SHAREPRODUCT',
    'APPROVE_DIVIDEND_SHAREPRODUCT',
  ]);
  const nativeActions = actions.filter((code) => !independent.has(code));
  const reads = [
    'READ_LOAN',
    'READ_LOANPRODUCT',
    'READ_CLIENT',
    'READ_SAVINGSACCOUNT',
    'READ_SAVINGSPRODUCT',
    'READ_PERMISSION',
    'READ_CONFIGURATION',
    'READ_AUDIT',
    'READ_OFFICE',
    'READ_DIVIDEND_SHAREPRODUCT',
  ];
  // Fineract 1.12 excludes *_CHECKER from GET /permissions. The role
  // permission catalogue includes them; validate there before assigning them.
  for (const code of [...actions, ...reads])
    assert(available.has(code), `Pinned permission missing: ${code}`);
  async function actor(label, codes) {
    const credentials = {
      username: `${prefix}_${label}`,
      password: localStaffPassword(),
    };
    const role = scalarId(
      await native(root, 'POST', 'roles', {
        name: `${prefix}_${label}`,
        description: 'Disposable SACCO acceptance only',
      }),
    );
    const catalogue = await native(root, 'GET', `roles/${role}/permissions`);
    const availableForRole = new Set(
      catalogue.permissionUsageData.map((permission) => permission.code),
    );
    for (const code of codes)
      assert(
        availableForRole.has(code),
        `Pinned role permission missing: ${code}`,
      );
    await native(root, 'PUT', `roles/${role}/permissions`, {
      permissions: Object.fromEntries(codes.map((code) => [code, true])),
    });
    const configured = await native(root, 'GET', `roles/${role}/permissions`);
    assert.deepEqual(
      configured.permissionUsageData
        .filter((permission) => permission.selected)
        .map((permission) => permission.code)
        .sort(),
      [...codes].sort(),
      'The disposable role must have exactly the requested permissions',
    );
    const userId = scalarId(
      await native(root, 'POST', 'users', {
        username: credentials.username,
        firstname: 'Local',
        lastname: 'SaccoAcceptance',
        email: `${credentials.username}@example.invalid`,
        officeId: office,
        roles: [role],
        password: credentials.password,
        repeatPassword: credentials.password,
        sendPasswordToEmail: false,
        isSelfServiceUser: false,
        passwordNeverExpires: true,
      }),
    );
    return {
      credentials,
      userId,
      client: new Fineract(endpoint, 'default', credentials),
    };
  }
  const maker = await actor('maker', [
      ...reads,
      ...actions,
      ...nativeActions.map((p) => p + '_CHECKER'),
    ]),
    checker = await actor('checker', [
      ...reads,
      ...actions.filter((code) => independent.has(code)),
      ...nativeActions.map((p) => p + '_CHECKER'),
    ]);
  // The pinned posting job is tenant-wide, not a per-product staff command.
  // Keep its broad scheduler permission out of customer actors and the API.
  const scheduler = await actor('scheduler', [
    'READ_SCHEDULER',
    'EXECUTEJOB_SCHEDULER',
  ]);
  const postingJobs = (await native(scheduler.client, 'GET', 'jobs')).filter(
    (job) => job.displayName === 'Post Dividends For Shares',
  );
  assert.equal(postingJobs.length, 1, 'Pinned dividend posting job required');
  const postingJob = postingJobs[0];
  await assert.rejects(
    () =>
      maker.client.request(
        'POST',
        `jobs/${postingJob.jobId}?command=executeJob`,
        {},
      ),
    { code: 'FINERACT_PERMISSION_DENIED' },
    'Customer maker must not execute tenant-wide jobs',
  );
  oldPostingJob = postingJob;
  assert.equal(postingJob.currentlyRunning, false);
  // Avoid a scheduled run racing the explicit, disposable acceptance run.
  await native(root, 'PUT', `jobs/${postingJob.jobId}`, {
    active: false,
  });
  async function runDividendPosting() {
    const path = `jobs/${postingJob.jobId}`;
    const before = await native(scheduler.client, 'GET', path);
    assert.equal(before.currentlyRunning, false);
    await native(scheduler.client, 'POST', `${path}?command=executeJob`, {});
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const job = await native(scheduler.client, 'GET', path);
      const history = job.lastRunHistory;
      if (
        !job.currentlyRunning &&
        history?.version !== before.lastRunHistory?.version &&
        history?.jobRunEndTime
      ) {
        assert.equal(history.status, 'success', 'Dividend job must complete');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.fail('Dividend posting job did not finish within 60 seconds');
  }
  stage = 'configured cash accounting product';
  const gl = {};
  for (const [name, type] of [
    ['cash', '1'],
    ['loanPortfolio', '1'],
    ['loanSuspense', '1'],
    ['savings', '2'],
    ['dividendPayable', '2'],
    ['equity', '3'],
    ['income', '4'],
    ['expense', '5'],
  ])
    gl[name] = scalarId(
      await native(root, 'POST', 'glaccounts', {
        name: `${prefix}_${name}`,
        glCode: `${prefix}_${name}`,
        manualEntriesAllowed: true,
        type,
        usage: '1',
        description: 'Disposable accounting fixture',
      }),
    );
  // Pinned native accounting requires financial activity 201 to debit the
  // dedicated dividend-payable liability when crediting members' savings.
  await native(root, 'POST', 'financialactivityaccounts', {
    financialActivityId: '201',
    glAccountId: gl.dividendPayable,
  });
  const currencies = await native(root, 'GET', 'currencies');
  const selected = currencies.selectedCurrencyOptions.map((c) => c.code);
  if (!selected.includes('UGX'))
    await native(root, 'PUT', 'currencies', {
      currencies: [...selected, 'UGX'],
    });
  const product = scalarId(
    await native(root, 'POST', 'savingsproducts', {
      name: `${prefix}_cash_savings`,
      shortName: randomBytes(2).toString('hex'),
      currencyCode: 'UGX',
      digitsAfterDecimal: '0',
      inMultiplesOf: '0',
      nominalAnnualInterestRate: '0',
      interestCompoundingPeriodType: '1',
      interestPostingPeriodType: '4',
      interestCalculationType: '1',
      interestCalculationDaysInYearType: '365',
      accountingRule: '2',
      minRequiredOpeningBalance: '0',
      withdrawalFeeForTransfers: false,
      allowOverdraft: false,
      savingsReferenceAccountId: gl.cash,
      savingsControlAccountId: gl.savings,
      transfersInSuspenseAccountId: gl.savings,
      interestOnSavingsAccountId: gl.expense,
      incomeFromFeeAccountId: gl.income,
      incomeFromPenaltyAccountId: gl.income,
      overdraftPortfolioControlId: gl.cash,
      incomeFromInterestId: gl.income,
      writeOffAccountId: gl.expense,
      locale: 'en',
    }),
  );
  const paymentTypeId = scalarId(
    await native(root, 'POST', 'paymenttypes', {
      name: `${prefix}_cash`,
      description: 'Disposable cash receipt',
      isCashPayment: true,
      position: '1',
    }),
  );
  stage = 'configured disposable loan product';
  const loanProduct = scalarId(
    await native(root, 'POST', 'loanproducts', {
      name: `${prefix}_loan`,
      shortName: randomBytes(2).toString('hex'),
      currencyCode: 'UGX',
      digitsAfterDecimal: '0',
      inMultiplesOf: '0',
      principal: '100000',
      numberOfRepayments: '1',
      repaymentEvery: '1',
      repaymentFrequencyType: '2',
      interestRatePerPeriod: '1',
      interestRateFrequencyType: '2',
      amortizationType: '1',
      interestType: '1',
      interestCalculationPeriodType: '1',
      transactionProcessingStrategyCode: 'mifos-standard-strategy',
      daysInMonthType: '1',
      daysInYearType: '1',
      isInterestRecalculationEnabled: false,
      accountingRule: '2',
      locale: 'en',
      fundSourceAccountId: gl.cash,
      loanPortfolioAccountId: gl.loanPortfolio,
      transfersInSuspenseAccountId: gl.loanSuspense,
      interestOnLoanAccountId: gl.income,
      incomeFromFeeAccountId: gl.income,
      incomeFromPenaltyAccountId: gl.income,
      incomeFromRecoveryAccountId: gl.income,
      writeOffAccountId: gl.expense,
      overpaymentLiabilityAccountId: gl.savings,
      goodwillCreditAccountId: gl.expense,
      chargeOffExpenseAccountId: gl.expense,
      chargeOffFraudExpenseAccountId: gl.expense,
      incomeFromChargeOffInterestAccountId: gl.income,
      incomeFromChargeOffFeesAccountId: gl.income,
      incomeFromChargeOffPenaltyAccountId: gl.income,
      incomeFromGoodwillCreditInterestAccountId: gl.income,
      incomeFromGoodwillCreditFeesAccountId: gl.income,
      incomeFromGoodwillCreditPenaltyAccountId: gl.income,
    }),
  );
  stage = 'configured disposable share product';
  const shareProduct = scalarId(
    await native(root, 'POST', 'products/share', {
      name: `${prefix}_shares`,
      shortName: randomBytes(2).toString('hex'),
      description: 'Disposable share and dividend proof',
      currencyCode: 'UGX',
      digitsAfterDecimal: '0',
      inMultiplesOf: '0',
      totalShares: '1000',
      sharesIssued: '1000',
      unitPrice: '1000',
      minimumShares: '1',
      nominalShares: '10',
      maximumShares: '100',
      allowDividendCalculationForInactiveClients: false,
      minimumActivePeriodForDividends: '1',
      minimumactiveperiodFrequencyType: '0',
      lockinPeriodFrequency: '1',
      lockinPeriodFrequencyType: '0',
      accountingRule: '2',
      shareReferenceId: gl.cash,
      shareSuspenseId: gl.savings,
      shareEquityId: gl.equity,
      incomeFromFeeAccountId: gl.income,
      locale: 'en',
    }),
  );
  stage = 'verified Yapesa staff mapping';
  await login('root', 'MEETING_ADMIN');
  await login('maker', 'MEETING_SECRETARY');
  await login('checker', 'MEETING_TREASURER');
  org = (
    await setup('create', {
      name: 'Disposable native SACCO',
      country: 'UG',
      currency: 'UGX',
      zone: 'Africa/Kampala',
      instance: 'local_sacco',
      tenant: 'default',
    })
  ).id;
  for (const [label, actor] of [
    ['maker', maker],
    ['checker', checker],
  ]) {
    const session = await ok(label, 'GET', '/api/session'),
      person = session.user.person_id;
    await setup('role', { org, person, role: 'manager', enabled: true });
    await ok('root', 'POST', `/api/admin/saccos/${org}/identities`, {
      request_id: v7(),
      device_id: v7(),
      person,
      user: actor.userId,
      username: actor.credentials.username,
      reason: 'Match the unique disposable staff identity',
    });
    await ok(label, 'POST', `/api/saccos/${org}/connect`, {
      ...actor.credentials,
      device_id: v7(),
    });
  }
  stage = 'native maker checker controls';
  await native(root, 'PUT', `configurations/${oldConfiguration.id}`, {
    enabled: true,
  });
  await native(root, 'PUT', 'permissions', {
    permissions: Object.fromEntries(
      actions.map((code) => [code, !independent.has(code)]),
    ),
  });
  stage = 'member lifecycle';
  const clientId = await execute('member.create', {
    officeId: office,
    firstname: 'Local',
    lastname: 'SaccoMember',
    submittedOnDate: start,
  });
  assert(clientId);
  await execute('member.activate', { activationDate: start }, clientId);
  stage = 'savings lifecycle';
  const savingsId = await execute('savings.apply', {
    clientId,
    productId: product,
    submittedOnDate: start,
  });
  assert(savingsId);
  await execute('savings.approve', { approvedOnDate: start }, savingsId);
  await execute('savings.activate', { activatedOnDate: start }, savingsId);
  const balance = async () =>
    fineractMinor(
      (
        await native(
          maker.client,
          'GET',
          `savingsaccounts/${savingsId}?associations=all`,
        )
      ).summary.accountBalance,
      0,
    );
  assert.equal(await balance(), '0');
  stage = 'pending cash and duplicate protection';
  const deposit = await submit(
    'savings.deposit',
    { transactionDate: today, transactionAmount: '100000', paymentTypeId },
    savingsId,
  );
  assert.equal(
    await balance(),
    '0',
    'A pending deposit must not change the account balance',
  );
  const replay = await ok(
    'maker',
    'POST',
    `/api/saccos/${org}/commands`,
    deposit.command,
  );
  assert.deepEqual(replay, deposit.result);
  await check(deposit);
  assert.equal(await balance(), '100000');
  await ok('maker', 'POST', `/api/saccos/${org}/commands`, deposit.command);
  assert.equal(await balance(), '100000', 'A replay must not duplicate cash');
  stage = 'cash withdrawal';
  await execute(
    'savings.withdraw',
    { transactionDate: today, transactionAmount: '25000', paymentTypeId },
    savingsId,
  );
  assert.equal(await balance(), '75000');
  stage = 'native loan schedule and lifecycle';
  const terms = {
    clientId,
    productId: loanProduct,
    principal: '100000',
    loanTermFrequency: '1',
    loanTermFrequencyType: '2',
    numberOfRepayments: '1',
    repaymentEvery: '1',
    repaymentFrequencyType: '2',
    interestRatePerPeriod: '1',
    amortizationType: '1',
    interestType: '1',
    interestCalculationPeriodType: '1',
    transactionProcessingStrategyCode: 'mifos-standard-strategy',
    expectedDisbursementDate: start,
    submittedOnDate: start,
  };
  const quote = await ok('maker', 'POST', `/api/saccos/${org}/commands`, {
    request_id: v7(),
    operation: 'loan.quote',
    values: terms,
  });
  assert.equal(quote.status, 'preview');
  const loanId = await execute('loan.apply', terms);
  const loan = () =>
    native(maker.client, 'GET', `loans/${loanId}?associations=all`);
  assert.equal((await loan()).status.pendingApproval, true);
  await execute('loan.approve', { approvedOnDate: start }, loanId);
  const disburse = await submit(
    'loan.disburse',
    { actualDisbursementDate: start, paymentTypeId },
    loanId,
  );
  assert.equal(
    (await loan()).status.waitingForDisbursal,
    true,
    'Pending disbursement must not move money',
  );
  await check(disburse);
  const activeLoan = await loan();
  assert.equal(activeLoan.status.active, true);
  assert.equal(
    fineractMinor(activeLoan.summary.principalOutstanding, 0),
    '100000',
  );
  assert.equal(fineractMinor(activeLoan.summary.interestCharged, 0), '1000');
  const repayment = await submit(
    'loan.repay',
    {
      transactionDate: today,
      transactionAmount: '101000',
      paymentTypeId,
    },
    loanId,
  );
  assert.equal(
    fineractMinor((await loan()).summary.principalOutstanding, 0),
    '100000',
  );
  await check(repayment);
  const settled = await loan();
  assert.equal(fineractMinor(settled.summary.totalOutstanding, 0), '0');
  assert.equal(settled.status.closedObligationsMet, true);
  await ok('maker', 'POST', `/api/saccos/${org}/commands`, repayment.command);
  assert.equal(
    fineractMinor((await loan()).summary.totalRepayment, 0),
    '101000',
    'Replayed repayment must not duplicate cash',
  );
  stage = 'native share lifecycle';
  const shareId = await execute('share.apply', {
    clientId,
    productId: shareProduct,
    savingsAccountId: savingsId,
    submittedDate: start,
    applicationDate: start,
    requestedShares: '10',
  });
  await execute('share.approve', { approvedDate: start }, shareId);
  await execute('share.activate', { activatedDate: start }, shareId);
  const share = await native(maker.client, 'GET', `accounts/share/${shareId}`);
  assert.equal(share.status.code, 'shareAccountStatusType.active');
  assert.equal(share.summary.totalApprovedShares, '10');
  stage = 'native dividend allocation and approval';
  const dividend = await submit(
    'dividend.declare',
    {
      dividendPeriodStartDate: start,
      dividendPeriodEndDate: iso(-1),
      dividendAmount: '1000',
    },
    shareProduct,
  );
  await check(dividend);
  const payouts = () =>
    native(root, 'GET', `shareproduct/${shareProduct}/dividend`);
  const declared = (await payouts()).pageItems;
  assert.equal(declared.length, 1);
  assert.equal(fineractMinor(declared[0].amount, 0), '1000');
  const dividendId = declared[0].id;
  const detail = await native(
    root,
    'GET',
    `shareproduct/${shareProduct}/dividend/${dividendId}`,
  );
  assert.equal(detail.pageItems.length, 1);
  assert.equal(fineractMinor(detail.pageItems[0].amount, 0), '1000');
  const beforeDividend = BigInt(await balance());
  const approval = await submit(
    'dividend.approve',
    {},
    shareProduct,
    dividendId,
  );
  assert.equal(
    BigInt(await balance()),
    beforeDividend,
    'Pending dividend approval must not credit savings',
  );
  await check(approval);
  assert.equal(
    (await payouts()).pageItems[0].status.code,
    'shareAccountDividendStatusType.approved',
  );
  assert.equal(BigInt(await balance()), beforeDividend);
  await ok('maker', 'POST', `/api/saccos/${org}/commands`, approval.command);
  assert.equal(
    BigInt(await balance()),
    beforeDividend,
    'A replay must not duplicate dividend credit',
  );
  stage = 'native dividend posting and repeated-job reconciliation';
  await runDividendPosting();
  const posted = await native(
    root,
    'GET',
    `shareproduct/${shareProduct}/dividend/${dividendId}`,
  );
  assert.equal(posted.pageItems.length, 1);
  assert.equal(
    posted.pageItems[0].status.code,
    'shareAccountDividendStatusType.posted',
  );
  const creditId = posted.pageItems[0].savingsTransactionId;
  assert.match(creditId, /^[1-9]\d*$/);
  assert.equal(BigInt(await balance()), beforeDividend + 1000n);
  const credit = await native(
    maker.client,
    'GET',
    `savingsaccounts/${savingsId}/transactions/${creditId}`,
  );
  assert.equal(fineractMinor(credit.amount, 0), '1000');
  assert.equal(credit.reversed, false);
  const visible = await ok(
    'maker',
    'GET',
    `/api/saccos/${org}/records/dividends?product=${shareProduct}&record=${dividendId}`,
  );
  assert.equal(visible.pageItems[0].savingsTransactionId, creditId);
  assert.equal(
    visible.pageItems[0].status.code,
    'shareAccountDividendStatusType.posted',
  );
  const visiblePayouts = await ok(
    'maker',
    'GET',
    `/api/saccos/${org}/records/dividends?product=${shareProduct}`,
  );
  assert.equal(visiblePayouts.pageItems[0].id, dividendId);
  assert.equal(
    (
      await call(
        'maker',
        'GET',
        `/api/saccos/${org}/records/dividends?product=999999999&record=${dividendId}`,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await call('maker', 'GET', `/api/saccos/${org}/records/dividends`))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await call(
        'maker',
        'GET',
        `/api/saccos/${org}/records/dividends?product=..`,
      )
    ).statusCode,
    400,
  );
  await runDividendPosting();
  assert.equal(
    BigInt(await balance()),
    beforeDividend + 1000n,
    'A repeated completed posting job must not credit a dividend twice',
  );
  stage = 'native journal reconciliation';
  const entries = await native(
    root,
    'GET',
    `journalentries?officeId=${office}&fromDate=${start}&toDate=${today}&dateFormat=yyyy-MM-dd&locale=en&limit=200&offset=0`,
  );
  assert(
    BigInt(entries.totalFilteredRecords) <= 200n,
    'No truncated reconciliation',
  );
  const scoped = entries.pageItems.filter((e) =>
    Object.values(gl).includes(e.glAccountId),
  );
  assert(scoped.length >= 4);
  const totals = new Map();
  for (const entry of scoped) {
    const sum = totals.get(entry.transactionId) ?? 0n;
    const amount = BigInt(fineractMinor(entry.amount, 0));
    const debit = entry.entryType.value.toUpperCase() === 'DEBIT';
    totals.set(entry.transactionId, sum + (debit ? amount : -amount));
  }
  for (const sum of totals.values())
    assert.equal(sum, 0n, 'Every native transaction must balance');
  const audit = await native(
    root,
    'GET',
    `audits/${deposit.result.result.command_id}`,
  );
  assert.equal(
    audit.maker,
    maker.credentials.username,
    'Native audit must identify the actual maker',
  );
  assert.equal(
    audit.checker,
    checker.credentials.username,
    'Native audit must identify the actual checker',
  );
  console.log(
    JSON.stringify({
      proof: 'local-sacco-savings-through-yapesa',
      fineractVersion: '1.12.0',
      actualVerifiedYapesaStaff: true,
      assignedIndividualEngineIdentities: true,
      requesterSelfCheckRejected: true,
      pendingCashNotPosted: true,
      duplicateCashPrevented: true,
      withdrawalBalanceMatched: true,
      nativeSharesAndDividendApprovalVerified: true,
      nativeDividendSavingsCreditVerified: true,
      repeatedDividendJobDidNotDuplicateCredit: true,
      nativeLoanLifecycleVerified: true,
      loanInterestAndSettlementMatched: true,
      loanRepaymentReplayPrevented: true,
      nativeJournalsBalanced: true,
      actualMakerAndCheckerAttributed: true,
      messagesSent: 0,
      externalPaymentTransfers: 0,
      limitation:
        'Disposable default tenant only; teller closes, two-tenant provisioning, hosted operation and supplied SACCO figures still require separate acceptance.',
    }),
  );
} finally {
  try {
    if (oldPostingJob)
      await root.request('PUT', `jobs/${oldPostingJob.jobId}`, {
        active: oldPostingJob.active,
      });
    if (oldPermissionSettings)
      await root.request('PUT', 'permissions', {
        permissions: oldPermissionSettings,
      });
    if (oldConfiguration)
      await root.request('PUT', `configurations/${oldConfiguration.id}`, {
        enabled: oldConfiguration.enabled,
      });
  } finally {
    await app.close();
  }
  // Financial records and their audit actors are deliberately retained in the
  // disposable CI engine. Never delete posted accounts or journals as cleanup.
}
