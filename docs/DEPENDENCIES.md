# Dependency register

All direct third-party JavaScript dependencies are listed below. Workspace packages
are private Yapesa code. Transitive versions are fixed in `pnpm-lock.yaml`. No SMS,
monitoring, payment, database-client or financial-calculation library is added yet.

| Package                          | Pinned version | Purpose                                                             | Licence    |
| -------------------------------- | -------------- | ------------------------------------------------------------------- | ---------- |
| `@eslint/js`                     | 10.0.1         | Official JavaScript ESLint recommended rules.                       | MIT        |
| `@expo/metro-runtime`            | 58.0.16        | Router/Metro runtime support.                                       | MIT        |
| `@expo/ui`                       | 58.0.26        | Expo Router peer dependency for native UI support.                  | MIT        |
| `@types/node`                    | 24.0.0         | Node runtime type declarations.                                     | MIT        |
| `@types/react`                   | 19.3.0         | React type declarations.                                            | MIT        |
| `@types/react-dom`               | 19.3.0         | React DOM type declarations.                                        | MIT        |
| `eslint`                         | 10.14.0        | Run static code checks and the local money-code rule.               | MIT        |
| `expo`                           | 58.0.22        | Expo SDK and development CLI for the mobile shell.                  | MIT        |
| `expo-constants`                 | 58.0.14        | Expo configuration support required by Router.                      | MIT        |
| `expo-dev-client`                | 58.0.18        | Native development builds instead of Expo Go.                       | MIT        |
| `expo-linking`                   | 58.0.15        | Deep-link support required by Router.                               | MIT        |
| `expo-router`                    | 58.0.29        | File-based mobile routing.                                          | MIT        |
| `expo-status-bar`                | 58.0.4         | Expo-compatible status bar support.                                 | MIT        |
| `expo-symbols`                   | 58.0.4         | Expo Router peer dependency for native symbols.                     | MIT        |
| `fastify`                        | 5.12.6         | Serve the API and test its routes with request injection.           | MIT        |
| `prettier`                       | 3.9.10         | Keep source, documentation and configuration formatting consistent. | MIT        |
| `react`                          | 19.3.0         | Render both application shells.                                     | MIT        |
| `react-dom`                      | 19.3.0         | Render the browser application.                                     | MIT        |
| `react-native`                   | 0.88.1         | Native Android and iOS application runtime.                         | MIT        |
| `react-native-safe-area-context` | 5.10.1         | Safe screen layout around device insets.                            | MIT        |
| `react-native-screens`           | 4.30.1         | Native navigation screens required by Router.                       | MIT        |
| `supabase`                       | 2.120.0        | Generate and run the local Supabase stack without a hosted project. | MIT        |
| `tsx`                            | 4.23.15        | Run and watch the TypeScript API and its Node test suite.           | MIT        |
| `turbo`                          | 2.11.10        | Run workspace tasks in dependency order and cache results.          | MIT        |
| `typescript`                     | 5.9.3          | Strict type checking across every application and package.          | Apache-2.0 |
| `typescript-eslint`              | 8.72.1         | Parse and lint TypeScript, including rule tests.                    | MIT        |
| `vite`                           | 8.3.5          | Serve and bundle the web shell.                                     | MIT        |

Tooling/runtime: pnpm and Node.js are MIT; Docker Engine and Compose are Apache-2.0 (Docker Desktop has separate subscription terms); Apache Fineract is Apache-2.0; PostgreSQL uses the PostgreSQL Licence.

Fineract remains unmodified. Mifos applications are not vendored or started in Phase 0. No licence is assigned to Fencher’s own source by this register.

## Web workspace additions

| Package            | Version | Purpose                                                                                           | Licence    |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------- | ---------- |
| `fast-check`       | 4.10.2  | Generate integer share-purchase cases to test balancing and exact reversals.                      | MIT        |
| `@playwright/test` | 1.64.1  | Exercise the web workspace in desktop and phone-width Chromium viewports and capture screenshots. | Apache-2.0 |

The generated Android source uses `expo-template-bare-minimum@58.0.31` (0BSD); signing keys are excluded, and the Android Gradle plugin generates a debug key locally. Web typography uses DM Sans and Manrope (SIL Open Font Licence 1.1), with local system fallbacks.

## Secure web additions

| Package               | Pinned version | Purpose                                                                     | Licence |
| --------------------- | -------------- | --------------------------------------------------------------------------- | ------- |
| `@fastify/cookie`     | 11.1.5         | Read/write HttpOnly session cookies.                                        | MIT     |
| `@fastify/rate-limit` | 10.3.0         | Throttle login/MFA requests.                                                | MIT     |
| `@fastify/swagger`    | 9.9.3          | Publish the API OpenAPI contract.                                           | MIT     |
| `openapi-typescript`  | 7.13.0         | Generate the client types from that contract.                               | MIT     |
| `uuid`                | 14.0.3         | Generate UUID v7 transaction/device references.                             | MIT     |
| `pg`                  | 8.23.1         | Disposable local test/provisioning connections only.                        | MIT     |
| `@types/pg`           | 8.15.5         | Type the provisioning and database tests.                                   | MIT     |
| `standardwebhooks`    | 1.0.0          | Verify signed Supabase Auth SMS hooks in the Edge Function and local tests. | MIT     |

Runtime Auth/Data API requests use native fetch. HMAC and authenticated cookie
encryption use Node's built-in cryptography. No application dependency adds a
second ledger or authentication provider.
