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

Remaining work:

- Programme relationships, scoped dashboards, attendance and repayment trends,
  arrears, and programme exports.
- Production backup scheduling, encrypted off-site retention and an isolated
  hosted/fresh-cluster restore exercise.
- Fineract per-staff identity, tenant templates and SACCO/lender workflows. Live
  hosting and the actual worked SACCO month/dividend examples are prerequisites
  for accepting those financial workflows.

Offline and native Android compilation remain deferred. Android sources are
maintained; a JavaScript export is not an APK/device test. No live financial
fixtures or unsolicited SMS messages are part of deployment. Closed financial
corrections remain locked pending the worked correction policy; review requests
preserve the original records without inventing adjustment rules.
