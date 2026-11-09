# Web completion work

Completed and live: group administration, shares and corrections, Social fund,
fines, scheduled loans, meetings with two-officer closing, final share-out and
individual payout receipts, share statements, PIN recovery, new-cycle setup with
post-share-out cash/Social carry-forward, calculation-review resolution and
closed-record review requests, staff activation, and two-administrator
lost-authenticator recovery. Verified platform administrators retain oversight
reads; money approvals still require actual current group-officer membership.

Audit extracts add original recorded actions and financial evidence with linked
balanced journals, inclusive dates and optional record references. See
`AUDIT_EXPORTS.md` for permissions, limits and verification. The local backup
restore proof is documented separately in `BACKUP_RESTORE.md`; it must not be
represented as a production backup service.

Programme reports add audited parent links and officer assignments, 21-day meeting
attention, attendance and repayment trends, exact arrears ageing, separate currency
totals and aggregate CSV exports. Programme officers receive no member identities,
individual group records or money permissions. See `PROGRAMME_REPORTS.md` for
scope, historical-date semantics and the current 500-group report bound.

Local Fineract identity proof verifies distinct staff users, exact restricted roles,
individual audit attribution, write revocation and rejected unknown tenants on the
pinned unmodified service. It creates no financial accounts. See
`FINERACT_STAFF_PROOF.md`; this is not a hosted tenant or SACCO/lender release.

Remaining work:

- Production backup scheduling, encrypted off-site retention and an isolated
  hosted/fresh-cluster restore exercise.
- Hosted Fineract staff mapping/credential storage, tenant templates and
  SACCO/lender workflows. Live
  hosting and the actual worked SACCO month/dividend examples are prerequisites
  for accepting those financial workflows.

Offline and native Android compilation remain deferred. Android sources are
maintained; a JavaScript export is not an APK/device test. No live financial
fixtures or unsolicited SMS messages are part of deployment. Closed financial
corrections remain locked pending the worked correction policy; review requests
preserve the original records without inventing adjustment rules.
