# Yapesa

Digital records for savings groups, lenders and SACCOs, from Fencher Technologies.
This repository includes the **Phase 0 foundation** and a **web Groups workspace
preview**. The web preview uses labelled sample records saved in this browser.
The authenticated online share-purchase path is implemented separately and requires
server/account configuration. A development deployment is available at
https://yapesa-web.onrender.com/#live with the first administrator activated.
See [hosting and onboarding](docs/HOSTING.md). The agreed scope
and later phases are in [the build brief](docs/BUILD_BRIEF.md).

## Saved organisation records

The secure online share-purchase workflow is available at `/#live` when the API
and accounts are configured. See [setup, controls and verification](docs/SECURE_WEB.md).
The sample workspace remains separate and needs no credentials.

Verified Fencher administrators can use **Administration** to create Groups,
register members and assign existing verified staff. See
[group setup and controls](docs/ADMINISTRATION.md). Deployment never seeds real
groups, people or financial entries.

The saved workspace also provides server-generated [PDF share statements](docs/STATEMENTS.md)
for the selected group or member, with the same account permissions as the ledger.

## Open the web workspace

After `pnpm install --frozen-lockfile`, run `pnpm --filter @yapesa/web dev` and open
http://127.0.0.1:5173. See [web workspace features and data boundaries](docs/WEB_WORKSPACE.md).
The sample workspace works without Docker. For the complete infrastructure stack,
use the fresh-clone instructions below.

## Start a fresh clone

Prerequisites: Git, Node **24.22.1**, pnpm **11.25.0**, and Docker Engine/Desktop
with Compose v2 running. Allow at least 8 GB of available memory for development
services and space for several GB of container images. On Windows, use WSL2 with
Docker integration. Native mobile builds also need Android Studio or Xcode.

From the cloned repository, run:

```sh
pnpm dev
```

This installs the locked dependencies, creates `.env` from `.env.example` if
missing, starts local Supabase, starts the pinned official Fineract image and its
separate PostgreSQL 17 database, and starts the API, web app and Expo development
server. First startup takes longer while downloading containers and applying
Fineract's own database migrations.

| Service                              | Local address                            |
| ------------------------------------ | ---------------------------------------- |
| Web                                  | http://127.0.0.1:5173                    |
| API liveness                         | http://127.0.0.1:3000/health             |
| Expo Metro                           | http://127.0.0.1:8081                    |
| Supabase API                         | http://127.0.0.1:54321                   |
| Supabase Studio                      | http://127.0.0.1:54323                   |
| Fineract (internal development only) | https://127.0.0.1:8443/fineract-provider |

Fineract has a self-signed local TLS certificate and its default demo tenant.
It is bound to loopback; its database has no host port. Do not expose this stack
or use it with customer records. The future Yapesa API will be its only caller.
Credentials and service keys must never be added to either client application.
Local demo credentials are not production credentials.

## Run on a phone

Android native source is checked in under `apps/mobile/android` for a later local
build. See [Android source instructions](docs/ANDROID_SOURCE.md). No native Android
build is scheduled in CI.

Use a **development build**, not Expo Go. With an Android emulator or USB-connected
device and Android SDK configured, run:

```sh
pnpm --filter @yapesa/mobile android
```

For a USB Android device, forward Metro with `adb reverse tcp:8081 tcp:8081`.
With the development build installed, `pnpm dev` starts Metro for subsequent work.
On macOS with Xcode, use `pnpm --filter @yapesa/mobile ios`. Alternatively, use the
checked-in `development` EAS profile after linking your Expo account/project.
No paid account or cloud service is required for the local stack.

## Checks and shutdown

```sh
pnpm check             # lint, formatting, strict types, tests, web build
pnpm mobile:export     # compile the Android JS bundle; not a native APK build
pnpm smoke:stack       # with infra up: probe all five services
pnpm infra:down        # stop containers; preserve database volumes
```

Ctrl+C stops the app processes; infrastructure stays running until
`pnpm infra:down`. To work only on app code after installation, use
`pnpm dev:apps`. No shutdown command deletes local data.

CI runs code checks, an Android bundle export, and a Docker-backed stack smoke
check. A device install and real 2 GB Android measurements remain separate manual
checks. See [verification status](docs/VERIFICATION.md) for what has actually run.
Branch protection must require `checks`, `local-stack`, `secure-web` and
`web-browser` before merging.

## Structure

- `apps/mobile`: Expo Router development-build shell.
- `apps/web`: React/Vite responsive web shell.
- `apps/api`: Fastify authentication gateway and protected share-purchase API.
- `packages/domain`: tested integer share-purchase and reversal calculations; online shares are recalculated and posted in Postgres.
- `packages/api-client`: generated OpenAPI types and typed API client.
- `packages/ui-tokens`, `i18n`, `country-packs`: shared foundations.
- `supabase`: CLI-generated local configuration, migrations and tests.
- `infra/fineract`: unmodified official Fineract **1.12.0**, Java 21,
  PostgreSQL **17.6**, and local tenant bootstrap.
- `infra/templates`: lender/SACCO templates begin in Phase 5.

Dependencies are exact-pinned with a committed pnpm lockfile. See
[dependency purposes and licences](docs/DEPENDENCIES.md),
[decisions](docs/DECISIONS.md), and [open questions](docs/OPEN_QUESTIONS.md).
