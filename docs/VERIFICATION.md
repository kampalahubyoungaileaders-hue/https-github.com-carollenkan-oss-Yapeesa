# Verification status

Checked on 2026-11-03. The latest results are attached to
[the secure web pull request](https://github.com/kampalahubyoungaileaders-hue/https-github.com-carollenkan-oss-Yapeesa/pull/2).

## Code and infrastructure

- `pnpm check` passes: ESLint, formatting, strict TypeScript across eight
  workspaces, unit/property tests and builds.
- Generated OpenAPI and client types reproduce without a Git diff.
- Android JavaScript/Hermes export passes. Android native source is checked in;
  native compilation and physical-device verification remain deferred at the
  founder's direction.
- GitHub's Docker-backed CI has started the actual Supabase/Fineract stack,
  verified Java 21, and passed the service smoke checks with PostgreSQL 17.
  The editing environment itself has no Docker runtime.

## Secure online web workflow

The disposable integration and desktop/360 px browser workflow has passed with
actual Supabase Auth and Postgres. It checks phone/PIN login, staff TOTP,
organisation isolation, denied direct writes, member restrictions, role/factor/
session revocation, journal balancing and immutability, integer calculation
parity, five-attempt lockout and 50 transactions replayed twice without duplicates.

The browser test commits a purchase, interrupts the response, retries its original
UUID, reloads the workspace, finds one matching ledger row and inspects its balanced
journal. It also checks horizontal overflow and absence of authentication data in
browser storage. A follow-up assertion checks that ledger search preserves the
headline totals. The separate demo browser workflow also passes.

Screenshots and logs are available in the workflow artifacts. CI results are
verification evidence, not certification of the whole platform or physical devices.

## Hosted state and remaining acceptance

The dedicated Yapesa Supabase project is healthy. Three versioned migrations are
installed, RLS is enabled, the security advisor returns no lints, and no real or
synthetic users, organisations or financial records have been provisioned there.

Hosted Auth provider/signup configuration is pending dashboard sign-in. Before
live use, provision the first verified administrator with a controlled PIN handover
and complete the supplied-email requirement described in `SECURE_WEB.md`. SMS
recovery and public hosting are not configured. Offline mobile sync, writer-device
transfer, live reversals and later modules remain separate work.

A native development build on the selected reference phone and GitHub branch
protection requiring the CI jobs remain acceptance tasks; a JavaScript export
must not be described as a successful device install.
