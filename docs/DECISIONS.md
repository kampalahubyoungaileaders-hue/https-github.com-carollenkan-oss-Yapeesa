# Decisions

The build brief is the source of truth. Phase 0 does not reopen its architecture.

- **2026-11-03 — Runtime:** Node 24.22.1 and pnpm 11.25.0 are pinned for consistent
  local and CI execution. TypeScript 5.9.3 stays within the supported peer ranges
  of the selected lint tooling; every package enables strict mode.
- **Expo SDK 58:** selected from current stable npm metadata. React, React Native
  and native-module versions follow Expo's `bundledNativeModules.json` for
  `expo@58.0.22`. No Expo Go workflow. Physical Android 9 compatibility and all
  performance targets still require validation; no device claims are made.
- **Fineract 1.12.0:** official image, unmodified, with PostgreSQL 17.6 on its own
  Docker network. The release's `build.gradle` specifies Java 21. Its upstream
  Compose example uses PostgreSQL 16.1; PostgreSQL 17 compatibility is therefore
  a test obligation, not an assumption. CI checks Java 21 and service readiness.
- **No money implementation in Phase 0:** no balances, journal entries, sign-in,
  customer tables, or provisional financial business rules. The custom ESLint
  rule rejects JS numbers, `number` types, floating parsers, Math and numeric
  coercion in `packages/domain/src` and money-named TypeScript files. Type branding,
  property tests and database invariants begin in Phase 1; lint alone cannot prove
  financial correctness.
- **i18n:** a small typed English dictionary is sufficient for the shell; every
  visible app message uses it. Uganda is an explicit selectable country pack,
  not a global application default. Organisation fields arrive in Phase 1.
- **Local-only infrastructure:** credentials in the ignored `.env` are disposable
  development values. Fineract is loopback-only and its database has no published
  port. Nothing is deployed and no hosted Supabase project is changed.

## Upstream references checked

- https://github.com/apache/fineract/blob/1.12.0/build.gradle
- https://github.com/apache/fineract/blob/1.12.0/config/docker/env/fineract-postgresql.env
- https://github.com/apache/fineract/blob/1.12.0/config/docker/env/fineract-common.env
- https://github.com/apache/fineract/blob/1.12.0/config/docker/postgresql/docker-entrypoint-initdb.d/01-init.sh
- https://supabase.com/docs/guides/local-development/cli/getting-started
- https://supabase.com/changelog.md

Supabase's current changelog was reviewed. Future schema work must grant Data API
access explicitly as appropriate and enable/test RLS; no user tables exist yet.

## Web-first follow-up

At the founder’s direction, Android source is prepared for a later local build and further development focuses on web. The new Groups workspace is an explicitly labelled browser demo, not a completed Phase 1 implementation. Shared integer-only share-purchase/reversal calculations have property tests; secure API/database posting and isolation controls remain mandatory before live records. No native APK build is scheduled.

## Secure online shares

- The Yapesa hosted Supabase project is `acqefirtqmfxttgrjoxu` in Frankfurt. It was created at the quoted USD 0/month after the founder confirmed the organisation and freed the second free-project slot.
- Supabase password-attempt hooks require Teams/Enterprise. To keep the agreed six-digit PIN and five-attempt lockout on the free setup, the API derives an opaque provider credential using a server pepper and verifies the PIN through Supabase Auth. A separately credentialed private gateway persists attempt counts. This does not use or expose the service key in financial requests.
- Staff use app-authenticator TOTP; paid Phone MFA is not introduced. Database access requires the current session and verified factor as well as the signed `aal` claim.
- New provider evidence: Supabase Auth issue 2872 reports failed TOTP enrolment for phone-only users. Until that fix reaches the pinned/hosted release, staff provisioning requires a supplied contact email alongside the verified phone; email is never guessed or falsely verified. Local CI alone uses reserved, non-deliverable email fixture labels. Phone/PIN remains the application's login method.
- A calculation mismatch posts the server-calculated value while preserving the original submitted amount/version and marking the transaction for review. No historical input is overwritten.
- Initial device designation is claimed atomically by the first accepted purchase. A different device is denied until an explicit transfer workflow is implemented.
- These changes implement the online web path. Native Android compilation, SMS recovery and other phase acceptance requirements are still separately tracked.

## Hosted web release — 4 November 2026

The founder approved a free Render web/API service in Frankfurt and explicitly
authorized its server configuration. The signed EgoSMS Auth hook is connected.
The first administrator completed real phone and TOTP verification before its
previously inactive role was activated in an audited transaction. No customer
groups or financial records were created. Earlier local-only notes above describe
the Phase 0 state, not the current deployment.

The free service can sleep after inactivity. Client requests allow up to 90 seconds
for startup, show a waiting status during authentication, and never automatically
retry mutations. HTML host loading/error responses become a safe connection error.
This does not change any financial calculation or authentication requirement.

## Verified group administration

Platform administration is an active Fencher-organisation membership plus a real
verified phone/TOTP session. Groups, explicit cycle settings, ledger members and
existing verified staff assignments use audited, deduplicated commands under a
private NOLOGIN/NOBYPASSRLS role. That role cannot write Auth accounts or journals.
Only an explicitly assigned secretary can post shares; being a platform admin
does not automatically make a person the secretary.

The existing fixed cycle share-price rule is retained from creation. Other initial
settings can be corrected before posting; all configuration locks afterward under
the same organisation lock as posting. Revoking membership excludes a person from
new purchases while retaining names needed to read historical transactions.

## Saved share corrections

A share correction appends an exact opposite journal and a linked signed
transaction. It cannot edit an original, reverse another reversal, or duplicate
an existing reversal. The same group lock and writer-device authority used for
purchases apply. Replays bind the actor as well as the payload. Existing closed
meeting locks are retained; later-period adjustments await an explicit policy.

Workspace, PDF and CSV totals include both purchases and reversals. Reversal
journals use `groups-shares-reversal-v1`; share purchase calculations remain
`groups-shares-v1`. No currency conversion or payment movement is introduced.

## Recorded share-fund preview

The saved Groups overview can preview distribution of the active cycle's recorded
share fund. It is read-only and explicitly excludes not-yet-implemented loan
income, fines and social-fund workflows. It neither closes the cycle nor records
payouts. Future account types fail closed until the preview is extended.

Largest remainders allocate whole minor units and preserve the exact fund total.
Equal remainders use ascending canonical member ID as a deterministic tie-break,
independent of roster order. TypeScript and SQL implementations are checked
against generated cases; the API also compares them on each returned preview.
Officers with verified MFA can view the full allocation. Former members' recorded
shares are retained; reversals reduce their net shares and the recorded fund.
