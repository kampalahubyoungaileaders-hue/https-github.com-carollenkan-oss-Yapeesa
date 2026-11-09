# Verification status

Updated 9 November 2026. The build brief remains the product source of truth;
passing a development release does not mean every phase is complete.

## Verified group functionality

The web group engine covers administration, share purchases and reversals,
Social fund, fines, configured scheduled loans, meeting attendance and
cash reconciliation, two-officer closing, final share-out and individual
cash-handover receipts, next-cycle carry-forward, and calculation/closed-record
review requests. Closed financial adjustments stay locked pending a worked policy.

Staff invitations require phone/PIN activation and a verified authenticator.
Lost-authenticator recovery requires two distinct verified administrators, recorded
identity checks, a fresh SMS session and a new verified factor. Self-approval is
forbidden. Prepared recovery blocks old staff/financial sessions independently
of Auth factor deletion. Verified platform-admin oversight reads are preserved;
actual group-officer membership is still required for financial approvals.

Recovery PR [#16](https://github.com/kampalahubyoungaileaders-hue/https-github.com-carollenkan-oss-Yapeesa/pull/16)
passed all four required jobs on `864d735a376254bdad9fcc44784d112f66e453ab`, merged
as `14e7484e90dea4965262c1209cb6ffb93ec0ad89`, and was confirmed live on Render.
The recovery release used sixteen canonical migrations through the administrator-scope
correction. The audit release adds the seventeenth canonical migration; the programme
release extends the schema separately.
Read-only production checks confirmed healthy web/API responses, no-store session
responses, rejected signed-out administrator reads, no anonymous scope execution,
no client journal INSERT privilege and zero invented financial records.

## Audit exports and restore proof

Audit extracts preserve exact source evidence as text, actor/device references,
linked originals/reversals and balanced journals. Unit checks and a rendered
four-page layout preserve accented names and integers beyond JavaScript's safe
integer range. Actual disposable Auth/RLS tests verify officer/admin access,
member and foreign-group denial, and exports that do not write money. Desktop
and phone download acceptance is included. PR
[#18](https://github.com/kampalahubyoungaileaders-hue/https-github.com-carollenkan-oss-Yapeesa/pull/18)
records its final required-check and merge status.

The same-cluster disposable pg_dump/pg_restore proof passed after real integration
fixtures: data fingerprints, owners/effective grants, RLS, definitions, triggers,
constraints, indexes and sequences matched; journals remained balanced and
immutable; a restored officer retained own-group access and saw no unrelated
journals. The private archive and temporary database are removed, not uploaded.
PR [#17](https://github.com/kampalahubyoungaileaders-hue/https-github.com-carollenkan-oss-Yapeesa/pull/17)
records its final required-check and merge status. This is not a hosted production
backup or a fresh-cluster recovery exercise.

## Deployment and remaining limits

Development web/API: https://yapesa-web.onrender.com/#live . The free service can
sleep; requests allow cold starts and do not automatically retry uncertain writes.
Supabase Auth, signed EgoSMS delivery and the first administrator's real phone and
TOTP verification were confirmed earlier. No live financial fixtures or unsolicited
messages are created by release checks. Server secrets stay off browser clients.
The security advisor reports the existing leaked-password-protection Auth warning,
with no database RLS notices at the recovery release.

Branch protection requires up-to-date pull requests and successful `checks`,
`local-stack`, `secure-web` and `web-browser` jobs without administrator bypass.
Each new head must pass; prior green results do not substitute for that head.
Local checks cover lint, formatting, strict types, domain/security tests and builds;
generated OpenAPI/client files must reproduce without a diff.

Programme reports add audited group links, verified officer assignment/invitation,
21-day meeting attention, monthly attendance/repayment trends, exact arrears ageing
and CSV exports without group-member identity or money access. Their pull request
records the real Auth/RLS and desktop/phone acceptance results. The local Fineract
identity proof independently passed restricted per-staff roles, individual audit
attribution, role revocation and unknown-tenant denial without creating financial
accounts or sending messages. Production backup scheduling, encrypted off-site retention
and an isolated hosted/fresh-cluster restoration are not yet configured or proven.
Pinned Fineract/Java 21/PostgreSQL 17 readiness passes Docker CI, but hosted staff
credential/link synchronization, tenant templates and SACCO/lender workflows remain. Live hosting
and actual worked SACCO month/dividend examples are prerequisites for financial
acceptance; group tables must never emulate their accounting.

Android source and JavaScript/Hermes export exist. Native APK compilation/device
measurements and offline workflows remain explicitly deferred by the founder.
See `WEB_COMPLETION.md`, `OPEN_QUESTIONS.md` and `BUILD_BRIEF.md`.
