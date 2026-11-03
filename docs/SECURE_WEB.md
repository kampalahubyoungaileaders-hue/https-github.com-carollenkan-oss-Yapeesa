# Secure online share-purchase workflow

The foundation is merged. This change adds an online workflow alongside the sample
workspace: phone/PIN sign-in, staff TOTP verification, organisation selection,
share recording and a persisted journal view. Open `/#live` in the web app.

## Hosted project

- Project: **Yapesa** (`acqefirtqmfxttgrjoxu`)
- Region: Frankfurt (`eu-central-1`)
- API: https://acqefirtqmfxttgrjoxu.supabase.co
- Creation quote: USD 0/month on the selected free organisation.
- The two schema migrations are applied. No customer identities or group records
  are seeded into this hosted project. Synthetic users are restricted to CI/local.

## Security and money controls

- Apps call the Yapesa API. The API forwards the signed-in user's token to the
  Supabase Data API; financial requests never use a service key.
- Phone/PIN sign-in derives an opaque provider password using HMAC-SHA256 with a
  server-only pepper. Supabase Auth stores its password hash. The raw six-digit
  PIN cannot be submitted directly to Supabase Auth to bypass the API lockout.
- A separate high-entropy gateway credential authorises two narrow PIN-counter
  operations. Only its SHA-256 digest is stored in a private database table.
  Five failed PIN attempts lock further attempts. Network/provider failures release
  their reserved attempt. Verified recovery is a separate, unfinished flow.
- Tokens are encrypted with AES-256-GCM and kept in a SameSite Strict, HttpOnly
  session cookie. Production configuration requires HTTPS and Secure cookies.
  No access token, refresh token, PIN or financial record is stored in browser
  local/session storage. Only opaque recording-device and retry references are stored.
- Mutating web requests require the configured exact Origin. Request bodies reject
  unknown fields and numeric-to-string coercion. PIN/MFA requests are rate limited.
- Staff need TOTP MFA. Database policies check the live Auth session, verified
  factor and current membership, so a stale JWT cannot retain a revoked role.
  Members can read their own records; officers can read their organisation.
- The posting role has no login, no RLS bypass and no financial update/delete
  privileges. Public RPC wrappers are security invokers. The private posting
  function validates the caller and remains subject to RLS under its narrow role.
- Debits equal credits through deferred database constraints. Financial rows,
  journal lines, audit entries and accepted sync receipts reject edits/deletes.
- Cycle price is immutable. Share count, currency and cycle dates come from the
  organisation's settings. All monetary calculations use bigint minor units and
  JSON strings; PostgreSQL rejects overflow and cumulative meeting-limit violations.
- UUID v7 receipts never expire. Reusing a UUID with the same request returns its
  original result; using it with different data fails. An interrupted web response
  retains the reference and freezes the form for an identical retry.
- Server amounts are authoritative. A differing submitted amount or calculation
  version is preserved with the transaction and audit entry and flagged for review.
  The record is not silently rewritten. Formal review/resolution UI comes later.

## Development and verification

Ordinary sample workspace: `pnpm --filter @yapesa/web dev`.

For a disposable real-Auth/database test environment, Docker must be running:

```sh
pnpm install --frozen-lockfile
pnpm exec supabase start
pnpm local:provision
pnpm test:integration
pnpm --filter @yapesa/api start
```

In another terminal run the web dev server, or run `pnpm test:live` after installing
Chromium with `pnpm exec playwright install chromium`. Local provisioning refuses
non-loopback URLs. It generates test credentials, seeds two organisations and
writes the ignored `.env`. Do not run the fixture job against hosted data.

The `Secure web workflow` CI job tests actual Supabase Auth, MFA, cookie behaviour,
SQL isolation/immutability/balancing, generated TS/SQL amount parity, 50 transactions
replayed twice and browser save/reload/ledger inspection at desktop/360 px. Its
browser test interrupts an already committed response and retries the same UUID.

Generate contract changes using `pnpm api:generate`; the OpenAPI document and
TypeScript client types are checked in together. `pnpm check` covers lint, strict
package types, unit/property tests and builds.

## Server configuration

Server-only environment variables: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`PIN_PEPPER`, `AUTH_GATEWAY_KEY`, `SESSION_COOKIE_KEY`, `WEB_ORIGIN`. The pepper,
gateway credential and cookie key must be random secrets held by the server;
`SESSION_COOKIE_KEY` is 32 bytes encoded in hex. Register the gateway key's digest
in `private.gateway_key` via the trusted provisioning job/administrator. The
pepper is part of the password derivation and requires a planned credential reset
when rotated; do not replace it without provisioning a new password for each user.

Accounts and memberships are administrator provisioned. Supabase Auth passwords
must be generated by `deriveAuthPassword` using the same server pepper; setting
an ordinary PIN directly in the Supabase dashboard is not this login scheme.
The first real administrator's verified phone/PIN handover and account provisioning
must be completed before using the hosted workspace. Production signup/provider
settings, SMS verification/recovery and public API/web deployment also remain to
be configured. Secrets are never committed to GitHub or put in Vite variables.

## Explicit remaining scope

This is the first secure online share-purchase path, not the entire platform.
Offline mobile storage/sync, writer-device transfer, live reversal endpoints,
attendance, loans, social fund, meeting approvals/close, share-out, PDF export,
programme views, SMS recovery and Fineract staff/tenant workflows remain later work.
Android native compilation stays deferred by the founder's instruction.
