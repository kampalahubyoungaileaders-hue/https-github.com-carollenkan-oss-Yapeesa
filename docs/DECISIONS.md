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
- A calculation mismatch posts the server-calculated value while preserving the original submitted amount/version and marking the transaction for review. No historical input is overwritten.
- Initial device designation is claimed atomically by the first accepted purchase. A different device is denied until an explicit transfer workflow is implemented.
- These changes implement the online web path. Native Android compilation, SMS recovery and other phase acceptance requirements are still separately tracked.
