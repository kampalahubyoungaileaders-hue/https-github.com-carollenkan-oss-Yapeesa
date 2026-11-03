# Phase 0 verification

Checks run successfully in the editing environment on 2026-11-03:

- `pnpm check`: ESLint, Prettier, strict TypeScript across all eight workspaces,
  money-rule test suite, API request-injection test, and workspace builds.
- The money-rule suite checks bigint code is accepted and rejects numeric
  literals, number types, Number/parseFloat/Math use and unary numeric coercion.
- `CI=1 EXPO_NO_TELEMETRY=1 pnpm mobile:export`: Android Hermes bundle exported
  successfully. This compiles the mobile shell and its Router dependencies;
  it does not prove a native install or a download-size target.
- Started the API, web development server and Expo Metro; their HTTP readiness
  endpoints returned 200 and the API/Metro response bodies matched expectations.
- `git diff --check`: no whitespace errors.

The editing environment has **no Docker runtime or Android/iOS build environment**.
Container startup, Fineract migrations, PostgreSQL 17 compatibility, native
installation and physical device behaviour have not been certified here.
GitHub CI contains a Docker-backed stack check; its result must be reviewed before
accepting Phase 0. No financial operations or user data are implemented.

## Remaining acceptance checks

1. Both GitHub CI jobs pass, including the pinned Java 21 runtime and full stack.
2. Fresh clone on a Docker-capable machine starts via `pnpm dev`.
3. Install the development build on the chosen reference phone and open the shell.
4. Require both CI jobs in branch protection before merging.
