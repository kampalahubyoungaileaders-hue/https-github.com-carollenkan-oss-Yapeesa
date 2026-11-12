# System completion and acceptance

The approved build brief remains the system specification. A green pull request
proves its listed checks, not completion of the entire platform. This checklist
separates implemented development workflows from customer and operational
acceptance. Android compilation and offline workflows remain explicitly deferred.
No paid resources are required to continue development.

| Area                             | Current evidence                                                                                                           | Required before accepting the complete system                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and Groups              | Live web workflows and Auth/RLS integration/browser suites; see WEB_COMPLETION.md                                          | Founder review and supplied group examples; closed-record correction policy remains unresolved                                              |
| SACCO connection                 | Fixed endpoints, unique tenant binding, encrypted staff identities; local named-tenant/isolation acceptance runner         | Automatic tenant/product provisioning; staff creation/revocation synchronisation; independent two-tenant isolation proof                    |
| Native savings                   | Disposable verified Yapesa staff apply, approve, activate, deposit, withdraw and reconcile balanced native journals        | Supplied SACCO statement and interest-period comparison; corrections, closures and outage recovery acceptance                               |
| Native shares and dividends      | Independent share/dividend approval and native allocation; posting-job credit/repeat-run checks in verify-sacco-engine.mjs | Supplied worked dividend method and member-by-member comparison; purchase/redemption acceptance                                             |
| Native loans                     | Disposable apply, approve, disburse, exact interest/repayment, settlement and replay checks                                | Supplied loan book/week repayments; arrears, guarantors/collateral, rescheduling, write-off and correction acceptance                       |
| Approval and uncertain outcomes  | Native maker-checker for cash/loans; immutable independent share/dividend review; no automatic dispatch retry              | Audited reconciliation of interrupted dispatch; hosted engine isolation; safe tenant-wide operational jobs                                  |
| SACCO teller                     | Read-only native teller catalogue                                                                                          | Allocations, cash movements, settlement, discrepancy handling and independent end-day acceptance                                            |
| Accounting and reports           | Native chart/journal reads and balanced disposable transactions; report catalogue                                          | Executable trial balance/income/balance sheet/board PAR, accruals, period close and supplied month comparison                               |
| Migration                        | No accepted customer import workflow                                                                                       | Anonymised source mapping, dry-run errors, duplicate detection, immutable import references, opening-balance and post-import reconciliation |
| Member services and KYC          | Staff member/account forms and identifiers                                                                                 | Person-to-native-member link, scoped self-service, controlled document uploads, next-of-kin and retention handling                          |
| Lenders                          | Shared engine/client foundations; local named-tenant and cash lender-template acceptance runner                            | Lender onboarding/templates, loan-book migration, collections, reports and supplied-record acceptance                                       |
| Notifications and administration | Existing Groups notification/admin foundations                                                                             | Confirm SACCO/lender notification policy, cost/consent reporting, billing administration; use mocks until a provider is configured          |
| Operations                       | Supabase and Fineract independent-cluster restore proofs; no hosted Fineract                                               | Budget-approved engine host, private access, encrypted off-site retention, scheduled backup/alerting and isolated hosted restore proof      |

## Supplied records

Exports from another system are suitable independent evidence. Work on anonymised
copies; retain stable member, account, loan and transaction references. Names,
phone numbers, addresses and identity documents are unnecessary for financial
acceptance. Never commit source exports or credentials to git or CI artifacts.
Keep the original export unchanged and record the source system, export time,
currency precision, SACCO timezone, date range and opening/closing conventions.

Request the following where available; missing pieces stay explicit:

- A closed SACCO month: opening/closing balances, dated transactions, trial
  balance and income/balance-sheet totals. Distinguish reversed/voided entries.
- Savings products and interest settings, statement balances and posted interest.
- Share holdings and movements, dividend period, approved distribution total,
  worked eligibility/weighting/rounding method and the actual member allocations.
- Loan products/terms, opening outstanding principal/interest/fees, schedules,
  repayments and arrears for a representative week; include rescheduled/written
  off loans if they are part of the acceptance set.
- Teller opening cash, allocations, deposits/withdrawals, counted closing cash,
  settlements and any actual discrepancy.

Do not infer missing business policy from a few records. Source exports first
support a dry run; importing financial history requires an approved mapping and
matching control totals. SACCO/lender records must be posted only through native
Fineract APIs, never through the Groups ledger.

## Dividend posting contract

Pinned upstream 1.12.0 selects every approved payout with initiated allocations
in the tenant for `Post Dividends For Shares`. Each allocation is credited through
the native savings domain service and linked to its savings transaction. Approval
alone does not mean a savings credit exists. The job may partially succeed before
reporting failure; inspect every allocation and transaction before deciding how
to proceed. A completed sequential repeat-run test is not proof that simultaneous
job executions are safe.

The disposable proof uses a separate restricted scheduler actor, disables the
job's schedule to avoid racing the acceptance run, waits for native job completion,
checks a 1,000 UGX credit and its posted allocation, runs the job again, and checks
that the balance is unchanged. Customer makers/checkers receive no scheduler
execution permission. No arbitrary job execution endpoint is exposed in Yapesa.
A tenant-wide operational release workflow remains required for hosting.

Native posting also requires financial activity `PAYABLE_DIVIDENDS` (201) mapped
to a liability account. The disposable setup creates a dedicated dividend-payable
liability and this mapping before posting; the running-engine check caught its
absence. A tenant template must include and validate this mapping. This fixture
does not define a customer's profit appropriation or dividend funding policy.

Upstream contracts:

- [Posting selection](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/java/org/apache/fineract/portfolio/shareaccounts/service/ShareAccountDividendReadPlatformServiceImpl.java)
- [Native savings credit](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/java/org/apache/fineract/portfolio/shareaccounts/service/ShareAccountSchedularServiceImpl.java)
- [Scheduled job API](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/java/org/apache/fineract/infrastructure/jobs/api/SchedulerJobApiResource.java)
