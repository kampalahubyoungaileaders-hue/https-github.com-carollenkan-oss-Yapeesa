# Verification status

Updated 4 November 2026. Current results and deployment details are recorded in
[the secure web pull request](https://github.com/kampalahubyoungaileaders-hue/https-github.com-carollenkan-oss-Yapeesa/pull/2).

## Verified release functionality

- Local `pnpm check`: lint, formatting, strict TypeScript, unit/property/security
  tests and builds. Generated OpenAPI/client files reproduce without a diff.
- All three GitHub workflows passed at `c972532`: CI `41778977533`, secure web
  `41778977562`, browser checks `41778977531`. New changes must pass again.
- Disposable actual Supabase Auth/Postgres tests cover phone/PIN, staff TOTP,
  organisation isolation, denied direct writes, role/factor/session revocation,
  balanced immutable journals, integer parity, lockout and repeated transactions.
- Desktop/360px browser checks cover saved purchases, interrupted-response retry,
  persistence/reload, journal inspection, invitation setup, PIN confirmation,
  explicit-only SMS requests, required MFA and browser storage boundaries.
- Docker CI verified pinned Fineract, Java 21 and PostgreSQL 17 service readiness.
- Android source is checked in and JavaScript/Hermes export passes. Native APK
  compilation and reference-device measurements remain deferred by the founder.

## Hosted deployment and account

The dedicated Yapesa Supabase project has four migrations and RLS enabled.
The signed EgoSMS hook and phone confirmations are enabled; public signup is off.
Handset SMS delivery and real phone verification succeeded. The first
administrator chose its PIN privately and verified a TOTP factor. An actual AAL2
session was checked before activating its membership in an audited transaction.
No live savings groups or financial records have been invented.

The free Frankfurt Render service hosts web and API on one origin at
https://yapesa-web.onrender.com/#live . Server configuration was explicitly
approved by the founder. Verified health 200, session `configured:true`,
cross-origin invitation rejection 403 and no server secrets in browser assets.
The service can sleep; a cold-start delay was observed. Browser requests now
allow 90 seconds and do not automatically retry uncertain mutations.

The latest security advisor returned no database RLS notices, and one Auth warning:
[leaked-password protection is disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
Provider passwords are server-derived opaque credentials, rather than raw PINs.
This is not a claim of independent security certification or production readiness.

## Separate remaining work

GitHub main-branch protection is configured: pull requests and passing `checks`,
`local-stack`, `secure-web` and `web-browser` jobs are required, branches must be
up to date, and administrator bypass is disabled. Force pushes and deletions stay
disallowed. The check jobs passed at `8b5da29`; the final PR records later runs.

Groups administration now covers explicit cycle setup, ledger-member registration,
existing verified staff roles, retry receipts and audited changes. Disposable real-Auth
integration tests pass for these controls and for preserved historical member names.
The administration PR records the latest complete browser/CI results.

Additional Auth-account invitations, customer-supplied group data, SMS recovery,
PDF statements, full meeting/loan/share-out engines, offline mobile sync and writer
transfer, live reversal endpoints, programme views and Fineract staff/tenant flows
remain later phases. Production backup/restore drills and monitoring are not yet
accepted. See `OPEN_QUESTIONS.md` and the phase acceptance checks in `BUILD_BRIEF.md`.
