# Yapesa — Full Build Instructions for ChatGPT

Fencher Technologies · 3 November 2026

## How to use this with ChatGPT

Paste **Part A** (every section from "Part A: Master context" down to "Testing and verification") at the start of every ChatGPT conversation. Then paste **one** phase prompt from Part B. One phase per conversation.

1. Use a ChatGPT setup that can read and write a code repository, such as a coding agent connected to GitHub. Plain chat can draft code, but you would copy every file by hand.
2. Paste Part A first. It is the standing brief and holds every decision already made.
3. Paste the next phase prompt from Part B. Do not skip phases. Each phase ends with a "Done when" check.
4. Before accepting a phase, run the tests yourself. Ask ChatGPT to explain any file you don't understand. If it cannot explain a money or security file line by line, reject it.
5. This document is the source of truth. If a decision changes, change it here first, then paste the new version.

ChatGPT will not build the whole platform in one go. Expect each phase to take several conversations, with you running and checking the code between them.

## Part A: Master context

You are the lead engineer building **Yapesa**, a platform from Fencher Technologies in Kampala, Uganda. Yapesa replaces paper ledgers for savings groups, small money lenders and SACCOs. It is **one platform**: one Android/iOS app and one web app, one login, one design, used by every role. Uganda is the first country, not the only one: currency, language, regulator and data rules come from a country pack (see "Built for many countries"), never from hard-coded values.

### The three modules

| Module         | Who uses it                                                                          | Where the money records live                    | Connectivity                                   |
| -------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------------- |
| Yapesa Groups  | Savings groups (VSLAs): secretary, treasurer, chair, members; NGO programme officers | Yapesa core (Supabase/Postgres), our own engine | Offline-first. Meetings happen with no network |
| Yapesa Lenders | Small licensed money lenders and their staff                                         | Apache Fineract                                 | Online, with offline field collection          |
| Yapesa SACCO   | SACCO managers, tellers, accountants, loan officers, field officers, members         | Apache Fineract                                 | Online. Read-only during outages               |

### Decisions already made (do not reopen them)

- Groups runs on our own engine in Supabase. Fineract has no savings-group meeting or share-out model.
- SACCO and Lenders money (accounts, loans, shares, ledger, interest accrual, teller) runs on **Apache Fineract, unmodified**, reached only through our API.
- Users never see Fineract or the Mifos apps. The free Mifos web app is used only internally by Fencher staff to configure products during implementation.
- Mobile: Expo (React Native), TypeScript. Web: React with Vite. API: Node.js with TypeScript. Shared logic: one TypeScript package.
- Yapesa records money. It never holds, receives or moves money.

### How you must work

1. Start every phase with a short plan: files you will create, the order, and the tests. Wait for approval before writing code.
2. Write tests before or alongside any code that calculates money or enforces security.
3. Work in small steps. One module at a time, merged before the next begins.
4. Add no library without saying what it does, why it is needed, and its licence. Prefer popular, stable libraries.
5. Never invent a business rule. If the spec is silent or unclear, ask. Put the question in an `OPEN_QUESTIONS.md` file and continue with what is clear.
6. TypeScript in strict mode everywhere. No `any` in money or security code.
7. When asked, explain any file line by line in plain language.

## Built for many countries

Uganda is first; other countries follow later. For now, build only these five hooks so a new country never needs a rewrite. Country-specific rules wait until there is a customer there.

- Money is an integer in the currency's smallest unit plus a currency code. One currency per organisation.
- Every organisation has a country code, currency and time zone.
- Phone numbers are stored in international (E.164) format.
- Dates are stored in UTC and shown in local time.
- All interface text goes through i18n from day one.

## Decisions from our discussion, and why

These were argued through before this brief was written. Treat them as settled. Reopen one only with new evidence, and record it in `DECISIONS.md`. Where this brief and the original Operating Guide disagree, this brief wins.

| #   | Decision                                                                  | Why                                                                                                                                                                                                                                                                | Rejected                                                   |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | Groups run on our own engine                                              | Fineract has no meeting, share-out or cash-box model, and one database per tenant cannot serve thousands of small groups                                                                                                                                           | Groups on Fineract                                         |
| 2   | SACCO and lender money runs on Apache Fineract                            | Years of production accounting: shares, dividends, accruals, teller, maker-checker. Used by about 100 institutions in Uganda, Kenya and Tanzania through Musoni. Removes the risk of an AI-written ledger                                                          | Building our own SACCO ledger                              |
| 3   | From Mifos we take the engine, not the apps                               | Mifos X is Fineract plus a web app and mobile apps. Fineract is the engine; the Mifos web app is internal only; the Mifos Android and member apps are skipped because they are separate native apps. Mifos Payment Hub may be evaluated in year 2 for mobile money | Running Mifos X as the product                             |
| 4   | No licence fees                                                           | Fineract is Apache 2.0; the Mifos apps are MPL 2.0. We use them unmodified, so our own code stays private                                                                                                                                                          | —                                                          |
| 5   | SACCOs are online                                                         | SACCO offices have connectivity. This removes multi-writer offline sync. Only field collections work offline, as pending receipts                                                                                                                                  | "Offline-first at every tier"                              |
| 6   | Lenders also on Fineract, from a template                                 | Loan maths (flat vs declining, partial payments, penalties, rescheduling) is where quiet bugs live. A template keeps onboarding to minutes                                                                                                                         | Lenders on the Groups loan engine                          |
| 7   | Fineract on its own Postgres, behind our API                              | Extra databases in Supabase sit outside its tools; credentials must stay on the server. This means we run a small API server                                                                                                                                       | Fineract inside Supabase; apps calling Fineract directly   |
| 8   | Each staff member is their own Fineract user                              | Otherwise Fineract's audit trail and maker-checker record one shared account and are worthless                                                                                                                                                                     | One shared service account                                 |
| 9   | Our own permanent dedupe table                                            | Fineract forgets idempotency keys after a set time; a phone can be offline longer                                                                                                                                                                                  | Relying only on Fineract's idempotency                     |
| 10  | Never modify Fineract's code                                              | Keeps upgrades possible                                                                                                                                                                                                                                            | Forking Fineract                                           |
| 11  | Web app in React + Vite                                                   | A login-gated back office needs no server rendering or SEO; simpler and cheaper to host                                                                                                                                                                            | Next.js                                                    |
| 12  | One platform means one core                                               | One domain package, one API contract, one permission model, one data model. Screens differ by surface where that suits the work                                                                                                                                    | Forcing every screen into shared UI code                   |
| 13  | Ledger rules enforced in Postgres; Groups post to the ledger from day one | An app bug cannot bypass a database constraint; the ledger is tested on real data from the first pilot                                                                                                                                                             | Ledger rules only in TypeScript; ledger unused until SACCO |
| 14  | One person identity across organisations                                  | Real people belong to a group, a SACCO and a lender at once                                                                                                                                                                                                        | Separate member records per organisation                   |
| 15  | Second factor for staff and approvers                                     | A 6-digit PIN alone is too weak for approving loans and withdrawals                                                                                                                                                                                                | PIN only for everyone                                      |
| 16  | Hosting is staged                                                         | Free while building; pay only when real records arrive                                                                                                                                                                                                             | Paying from day one                                        |

**Timeline reality.** With AI assistance, the code for a module takes weeks, not months. The calendar is set by things code cannot speed up: founder review, real-data verification, regulator formats, pilots and customer decisions. Because SACCO no longer waits for a custom ledger, it can reach market earlier than the original month 14. Promise customers only dates already proven in testing.

## Engineering rules

These keep the money right and the build clean. Everything else can be added later.

1. **Money is integers.** Whole numbers in the currency's smallest unit, with a currency code. Postgres `bigint`. No floating point anywhere. Use a branded `Money` type.
2. **Append-only.** Transactions are never edited or deleted; a mistake is fixed with a reversing entry. Enforce it with database triggers.
3. **Every journal balances.** Debits equal credits, enforced in the database.
4. **One balance, one home.** Group money lives in the Yapesa core; SACCO and lender money lives in Fineract.
5. **The server is the final calculator.** Phones calculate for display; the server recalculates and flags any difference.
6. **Organisations never see each other's data.** Enforced by row-level security and covered by tests.
7. **Never modify Fineract.** Use its API only.
8. **Secrets stay on the server.** No keys or Fineract credentials in the apps.
9. **No payment features.** Yapesa records money; nothing in the app moves money.

## Architecture

Two apps talk to one Yapesa API. The API talks to two backends: the Yapesa core for identity and Groups, and Fineract for SACCO and lender money.

### Components

| Component           | Technology                                                                              | Responsibility                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile app          | Expo (current SDK), TypeScript, Expo Router, expo-sqlite (encrypted), expo-secure-store | Meeting flow offline, passbook, approvals, field collection, member views                                                                                              |
| Web app             | React + Vite, TypeScript, a standard table library                                      | Back office: ledger views, tables, imports, setup, teller screens, programme dashboards, Fencher admin. Responsive down to 360 px                                      |
| Yapesa API          | Node.js + TypeScript (Fastify), OpenAPI contract                                        | The only thing the apps call. Verifies the user, applies permissions, runs Groups writes, calls Fineract on the staff member's behalf, sends SMS, runs background jobs |
| Yapesa core         | Supabase: Postgres, Auth, RLS, storage, scheduled jobs                                  | People, organisations, roles, devices, Groups engine data and ledger, sync receipts, audit log, SMS log, billing                                                       |
| Money engine        | Apache Fineract 1.x (pinned), Java 21, its own PostgreSQL 17 server                     | SACCO and lender clients, savings, shares, loans, ledger, accruals, teller, maker-checker                                                                              |
| Internal setup tool | Mifos web app, unmodified                                                               | Fencher staff configure products and charts of accounts. Never customer-facing                                                                                         |
| SMS                 | Africa's Talking, called only from the API                                              | Notifications and login codes                                                                                                                                          |
| Monitoring          | Sentry                                                                                  | Crash and error reports from apps and API                                                                                                                              |

### Rules for how they connect

- Apps never call Supabase tables for writes or Fineract at all. They call the Yapesa API.
- The API calls Supabase with the **user's own token**, so RLS still applies. The service key is used only for jobs that need it, and each such use is logged.
- Fineract runs on its own Postgres server, not inside Supabase. Each SACCO or lender is one Fineract tenant.
- Shared business logic lives once in `packages/domain` and is imported by the mobile app, the web app and the API.
- The API publishes a typed client (`packages/api-client`) generated from its OpenAPI contract. Both apps use it.

### Repository layout (pnpm workspaces + Turborepo)

```text
yapesa/
  apps/
    mobile/        Expo app
    web/           React + Vite back office
    api/           Fastify API service and background jobs
  packages/
    domain/        money type, interest, schedules, share-out, ledger postings, calc_version
    api-client/    generated typed client
    ui-tokens/     colours, spacing, type shared by app and web
    i18n/          all interface strings, per locale (en first)
    country-packs/ one folder per country (ug first): currency, phone rules, languages, holidays
  supabase/
    migrations/    SQL schema, RLS policies, posting functions, triggers
    tests/         RLS attack suite, posting parity tests
  infra/
    fineract/      docker-compose for Fineract + Postgres 17 (pinned versions)
    templates/     lender and SACCO tenant templates
  docs/
    OPEN_QUESTIONS.md
    DECISIONS.md
```

### How the pieces connect

```text
   Mobile app (Expo)             Web app (React + Vite)
   offline meetings, passbook    back office, teller, reports
            \                        /
             v                      v
        Yapesa API (Node.js, TypeScript) ----notifications----> Africa's Talking (SMS)
        sign-in, permissions, sync, SMS, background jobs
            |                               |
   user token, RLS applies          as the staff member
            v                               v
   Yapesa core (Supabase)          Apache Fineract (pinned)
   people, roles                   SACCO and lender money
   Groups engine and ledger        own PostgreSQL 17 server
                                            ^
                                            | configures
                                   Mifos web app (internal)
                                   Fencher staff set up products
```

Group money lives only in the Yapesa core; SACCO and lender money lives only in Fineract. Nothing reaches Fineract except through the API.

## Data model (Yapesa core)

One real person has one identity across every organisation they belong to. Design this in the first migration; it is painful to add later.

### Identity and access

| Table           | Holds                                                                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| person          | One row per human: names, phone (E.164), country, ID type and number, date of birth, photo reference. Linked to one Supabase Auth user when they can sign in                                              |
| organisation    | type (`group`, `lender`, `sacco`, `programme`, `fencher`), country code, currency, time zone, name, branch, parent programme, status, `fineract_tenant_id` for lenders and SACCOs                         |
| membership      | person + organisation + role (`member`, `secretary`, `treasurer`, `chair`, `field_officer`, `loan_officer`, `teller`, `accountant`, `manager`, `programme_officer`, `fencher_admin`), start and end dates |
| role_permission | Which actions each role may perform                                                                                                                                                                       |
| fineract_link   | Yapesa person or organisation ↔ Fineract tenant, office, client, group or app-user id                                                                                                                     |
| device          | Registered devices and the group each one records for                                                                                                                                                     |
| audit_log       | Every write: who, what, when, which device, before and after values                                                                                                                                       |
| sms_log         | Recipient, template, organisation, cost, status                                                                                                                                                           |
| sync_receipt    | Every client transaction UUID ever accepted, with its result. Never expires                                                                                                                               |

### Groups engine

| Table                  | Holds                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| group_settings         | Share price, maximum shares per meeting, interest rate and method, loan limit multiple, fine types and amounts, social fund rules, cycle length, rounding rule. Configuration, never code                   |
| cycle                  | Start, end, status, finalised share-out reference                                                                                                                                                           |
| meeting                | Date, cycle, opening cash, counted closing cash, expected closing cash, difference and explanation, close approvals                                                                                         |
| attendance             | Member, meeting, present / absent / excused, fine applied                                                                                                                                                   |
| group_txn              | Append-only: type, amount (integer minor units) and currency, member, meeting, entered by, approved by, device, client UUID, `calc_version`, debit account, credit account, journal id, reverses (nullable) |
| loan                   | Borrower, principal, rate, method, term, approval by group officers, status                                                                                                                                 |
| loan_schedule          | One row per instalment: due date, principal, interest, paid amount, paid date                                                                                                                               |
| ledger_account         | Per group: cash box, shares, social fund, loans receivable, interest income, fines income, payables                                                                                                         |
| journal + journal_line | Double-entry postings created only by Postgres posting functions. Lines must balance                                                                                                                        |
| share_out              | Per member result of the end-of-cycle calculation, with the inputs used                                                                                                                                     |

Every Groups transaction posts to the ledger from day one, so the ledger is tested on real data from the first pilot.

## Groups engine specification

A secretary runs a whole meeting on one phone with no network, and every member's record is right to the shilling. Every rate, limit and amount below comes from `group_settings`; none is hard-coded. Confirm the step order with real groups before the pilot.

### Default settings (standard VSLA methodology)

New groups start with these defaults. Every one is editable per group, because real groups vary; some allow more than 5 shares per meeting.

| Setting                   | Default                                                                                                                  | Rule                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Share value               | Set by the group at cycle start                                                                                          | Cannot change during the cycle                           |
| Shares per meeting        | 1 to 5                                                                                                                   | At least 1 share per meeting                             |
| Loan limit                | 3 × the member's share value                                                                                             | Checked before approval                                  |
| Service charge (interest) | Set by the group, monthly                                                                                                | Warn above 10% a month                                   |
| Loan term                 | Up to 3 months                                                                                                           | Repaid at meetings; partial payments allowed             |
| Social fund               | Equal contribution per member per meeting                                                                                | Kept separate; paid as grants, not loans; not shared out |
| Cycle length              | 9 to 12 months                                                                                                           | Ends with share-out                                      |
| Share-out                 | Loan fund (savings plus interest and fines) ÷ total shares = value per share; each member gets their shares × that value | All loans repaid before share-out                        |

Sources: [VSL Associates methodology](https://www.vsla.net/the-vsla-methodology/), [VSL programme guide for village agents](https://fsnnetwork.org/sites/default/files/2020-07/vsl_programme_guide_for_village_agents_-_version_1.04_english.pdf), [Helvetas VSLA topic sheet](https://www.helvetas.org/Publications-PDFs/HSI_TopicSheet_VillageSavings.pdf).

### Meeting flow (guided screens, in order)

1. **Open meeting.** Date, cycle, opening cash carried from the last close.
2. **Attendance.** Present, absent or excused per member; absence fines applied by rule.
3. **Share purchases.** Each member buys 1 to the maximum number of shares at the share price.
4. **Social fund.** Fixed contribution per member.
5. **Loan repayments.** Principal and interest due shown per borrower; partial payments allowed; interest calculated automatically.
6. **Fines.** From the configured list, with a reason.
7. **New loans.** Request, limit check, approval by the officers named in settings, schedule created.
8. **Social fund payouts.** Amount, member, reason, officer approval.
9. **Close.** Count the cash box, compare with the expected balance, record any difference with an explanation, two officers approve with their own PINs. The meeting locks.

Actions by other officers during an offline meeting (approving a loan, signing the close) happen on the writer device with that officer's own PIN, and are recorded against them.

### Calculations (all in `packages/domain`, all integer minor units)

- **Loan limit:** member's share value × the configured multiple.
- **Interest:** configurable method: flat on original principal, or monthly on the outstanding balance. Rate per month from settings.
- **Schedule:** the instalments always sum exactly to principal plus total interest. Rounding differences go to the last instalment.
- **Expected cash at close:** opening cash + all cash in − all cash out for the meeting.
- **Share-out:** the distributable fund is split in proportion to each member's shares; the social fund is excluded unless settings say otherwise. Use the largest-remainder method so payouts sum exactly to the fund. Show a preview at any time during the cycle.
- **Reversal:** a reversing entry restores every affected balance exactly.
- Every calculation result records the `calc_version` that produced it.

### Offline and sync

- The whole meeting flow works in airplane mode, including loan calculations and the share-out preview.
- **One writer per group.** One designated device records the group's transactions. Transfer to another device is an explicit, recorded action.
- Every transaction gets a client-generated UUID (v7), is written to a local outbox in SQLite inside the same database transaction as the screen's change, and is posted when a connection exists.
- The server checks `sync_receipt` first. A UUID already seen returns the original result and changes nothing.
- The server recalculates every amount with its own `packages/domain` version. A mismatch is accepted, flagged for review, and shown to a Fencher admin; it never silently overwrites.
- The app attempts a sync at every meeting close and shows clearly: how many meetings are waiting, and when the last sync succeeded.
- Data survives force-close, a flat battery mid-meeting, app updates, and nearly full storage. App database migrations must never drop unsynced outbox rows.
- A full 25-member meeting syncs in under 60 KB.
- If a phone is lost before syncing, the group can re-enter that meeting from its paper summary; the app offers a one-page meeting summary to photograph or print at each close.

## SACCO and Lenders on Fineract

Fineract does the accounting; Yapesa provides every screen, the identity, the permissions and the integration. Fineract runs from the official Docker image at one pinned 1.x version, on Java 21 and its own PostgreSQL 17 server.

### Tenants and templates

- Each SACCO or lender is one Fineract tenant (its own database). The API creates tenants automatically; no manual database work.
- Two templates in `infra/templates`, applied by the API when a tenant is created:
  - **Lender template:** chart of accounts, standard loan products (flat and declining balance), fees, penalties, roles.
  - **SACCO template:** chart of accounts, share product, savings products, loan products, charges, teller and cashier setup, roles.
- A new lender must be usable within minutes of signing up. Only unusual products need Fencher staff, who configure them in the internal Mifos web app.

### Staff identity (prove this first)

- Every SACCO or lender staff member gets their own Fineract app user in their tenant, created and kept in step by the API.
- Their Fineract roles are derived from their Yapesa roles. Yapesa is the one place where permissions are changed.
- The API calls Fineract **as that staff member**, so Fineract's audit trail and maker-checker show the real person. Never route all calls through one shared service account.
- Use the authentication method the pinned Fineract version supports (per-user credentials held only on the server, or OAuth if supported). Credentials never reach a device.

### Operations the API exposes

- Members and clients: create, KYC details (Fineract data tables), status, next of kin.
- Savings: open, deposit, withdraw, interest posting, statements. Withdrawals above a set amount need a second approver.
- Shares: purchase, redeem, statements.
- Loans: apply, guarantors, approve, disburse (recorded only), repay, reschedule, write off, schedule view.
- Teller: allocate cash to a teller, record cash in and out, end-of-day settlement. A deliberate discrepancy must be caught, not absorbed.
- Accounting: journal entries, accruals, period closing, trial balance, income statement, balance sheet.
- Migration: import members, savings, shares and loan books from Excel, with a report proving opening balances match before go-live.

### Field collections (the one offline case)

- A field officer offline records a collection on the phone as a **pending receipt** in the Yapesa core, never directly in Fineract.
- After sync, a staff member confirms it; the API posts it to Fineract with an `Idempotency-Key` header equal to the receipt's UUID.
- The API checks its own permanent `sync_receipt` table before posting, because Fineract forgets idempotency keys after a set time.

### Dividends (test first)

- Fineract computes dividends from average share balances. Ugandan SACCOs may use a different rule.
- Phase 5 runs a real SACCO's dividend through Fineract and compares it with their own figures.
- If it does not match, compute dividends in `packages/domain` using the SACCO's rule and post the results to Fineract through the API. Record the decision in `DECISIONS.md`.

### Reports

- Build: portfolio at risk, arrears ageing, loan book, savings and share balances, trial balance, income statement, balance sheet, teller reports.
- Regulator-specific reports come later, per country, once their formats are known.

### Connectivity

- SACCO and lender work is online. During an outage the apps show the last known data, read-only, clearly marked as such. Nothing that moves a balance is queued, except field-collection pending receipts.

## Security, notifications and app requirements

### Sign-in and access

- **Members:** phone number plus a 6-digit PIN, stored hashed. Lock after 5 wrong attempts.
- **Recovery:** an SMS code through Africa's Talking.
- **Staff and approvers:** a second factor at sign-in.
- Same account and same permissions on mobile and web.
- Row-level security on every Yapesa core table: members see their own records, officers their organisation, programme officers their programme.
- HTTPS everywhere; the phone's SQLite database encrypted.

### Notifications (SMS is the one cost that can wipe out a margin)

| Notification                          | Channel                | Default                                   |
| ------------------------------------- | ---------------------- | ----------------------------------------- |
| Every transaction, every member       | In-app passbook        | On, free                                  |
| Meeting summary to the three officers | SMS after each meeting | On                                        |
| Monthly statement to every member     | SMS, monthly           | On                                        |
| Loan due and arrears reminders        | SMS to the borrower    | On                                        |
| Per-meeting SMS to every member       | SMS                    | Off. Paid add-on, billed at cost plus 20% |

Every SMS is sent from the API only and logged in `sms_log` with its cost, per organisation.

### Web app

- One web app for every role, signed in with the same account as the phone.
- Web-first work: general ledger and statements, loan book, arrears ageing, teller screens, Excel import and export, product and fee setup, users and roles, programme dashboards, Fencher admin (organisations, billing, SMS spend).
- Everything else (passbook, loan approval, group summary) is available on the web too.
- Every screen usable down to a 360 px phone browser, with no horizontal scrolling.
- PDFs are generated on the server so app and web produce identical documents.
- A programme officer must answer, unaided: which of my groups have not met in three weeks, and which have repayment problems.

### Mobile app

| Requirement                  | Target                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Reference device             | 2 GB RAM, Android 9, bought locally for under UGX 400,000. Test here first         |
| Download size                | Under 30 MB                                                                        |
| Cold start to meeting screen | Under 4 seconds on the reference device                                            |
| Battery                      | A two-hour meeting uses under 15%                                                  |
| Sync payload                 | A 25-member meeting under 60 KB                                                    |
| Data cost                    | A month of normal use under UGX 1,000 or the local equivalent                      |
| Literacy                     | Every action reachable by icon and number                                          |
| Training                     | A secretary new to smartphones runs a meeting unaided after 90 minutes of training |

Use Expo development builds, not Expo Go. Builds and over-the-air updates through EAS. Over-the-air updates must never change a calculation without a new `calc_version`.

## Testing and verification

No code that touches money or security is finished until these tests pass in CI. GitHub Actions runs them on every change, and nothing merges while one fails.

1. **Property tests** (fast-check) on `packages/domain`: a schedule always sums to principal plus interest; every journal balances; a share-out sums exactly to the fund; a reversal restores the prior balances; no amount is ever a fraction.
2. **Parity tests:** the TypeScript calculation and the Postgres posting function give identical results for generated cases.
3. **Sample datasets:** a realistic twelve-month group cycle and a SACCO month; the system reproduces the expected totals exactly. Swap in real records when available.
4. **Isolation tests:** a user from organisation A cannot read or write organisation B's data, for every table.
5. **Sync tests:** 50 offline transactions synced twice produce exactly 50 records; a force-close mid-meeting loses nothing; four offline meetings sync correctly.
6. **Fineract integration tests** against the pinned Fineract in Docker, including posting the same transaction twice.
7. **End-to-end tests:** Maestro for the mobile meeting flow, Playwright for the web app.

## Part B: Phase prompts

Paste Part A, then one of these. Each phase builds on the last, and the riskiest assumptions are tested first.

### Phase 0: Repository and local environment

```text
Phase 0. Set up the monorepo exactly as in the Architecture section: pnpm workspaces, Turborepo, TypeScript strict, ESLint with a rule banning floating-point money, Prettier, GitHub Actions CI. Create empty apps (mobile, web, api) and packages (domain, api-client, ui-tokens, i18n, country-packs). Add infra/fineract/docker-compose.yml running the official Fineract image at one pinned 1.x version with PostgreSQL 17, plus a local Supabase setup via the Supabase CLI. Write a README that starts everything with one command.
Done when: a fresh clone runs all three apps, Fineract and Supabase locally with one command, and CI passes on an empty test.
```

### Phase 1: Thin vertical slice

```text
Phase 1. Build one path through the whole system before any breadth. The Money type (integer minor units plus ISO 4217 currency code) and a minimal ledger in packages/domain with property tests. Migrations for person, organisation, membership, device, sync_receipt, audit_log, group_settings, meeting, group_txn, ledger_account, journal, journal_line, with RLS and posting functions that enforce balanced, append-only journals. A mobile screen that records share purchases for one meeting offline into encrypted SQLite with an outbox. API endpoint that accepts the sync, dedupes by UUID, recalculates and posts to the ledger. A web page showing that meeting and its ledger, with a PDF export. The RLS attack suite for these tables.
Done when: on a 2 GB Android phone in airplane mode, a meeting is recorded, synced twice later, produces exactly one set of records, balances in the ledger, shows on the web and exports to PDF, and every RLS attack test fails as it should.
```

### Phase 2: Complete Groups meeting engine

```text
Phase 2. Implement the full Groups engine specification: all nine meeting steps, loan engine with both interest methods and schedules, fines, social fund, cash box reconciliation with two-officer close, share-out with largest-remainder rounding and live preview, passbook per member, reversals. All calculations in packages/domain with property tests and Postgres parity tests.
Done when: a simulated twelve-month cycle for a 25-member group runs on the reference phone with no network, and the share-out matches an independent hand calculation to the shilling.
```

### Phase 3: Sync hardening and device performance

```text
Phase 3. Harden offline behaviour: writer-device designation and transfer, sync status screen, calc_version recorded and mismatch flagging, survival of force-close, flat battery and app update, on-device database migrations that preserve the outbox, one-page meeting summary at close. Measure and meet every mobile target in the requirements table.
Done when: every sync test in Testing passes, and the app meets size, start-up, battery and payload targets on the reference device.
```

### Phase 4: Web, PDFs, SMS and programme views

```text
Phase 4. Build the web app for Groups and programmes: group list and health, attendance and repayment trends, arrears, exports, users and roles, settings. Server-side PDF statements and audit-log extracts. SMS through Africa's Talking sandbox with the notification policy table and per-organisation cost logging in sms_log. Phone + PIN sign-in, recovery by SMS, second factor for staff. Fencher admin: organisations, SMS spend.
Done when: a programme officer answers unaided which groups have not met in three weeks and which have repayment problems; an audit log for a disputed transaction is produced as a PDF in under two minutes.
```

### Phase 5: Fineract foundation (three spikes)

```text
Phase 5. Prove three things against the pinned Fineract in Docker, and write the result of each in DECISIONS.md. (1) Staff identity: create a Fineract app user per Yapesa staff member, map roles, and make API calls as that user so Fineract's audit trail and maker-checker show the real person. (2) Lender template: create a tenant automatically and apply the lender template. (3) Dividends: run a SACCO share product and dividend through Fineract and compare with a supplied SACCO calculation. Build the fineract_link table, the Fineract client module in the API, and idempotent posting backed by sync_receipt.
Done when: all three spikes pass or have a documented fallback, and integration tests cover them.
```

### Phase 6: Yapesa Lenders

```text
Phase 6. Build the Lenders module on Fineract through the API: self-serve signup creating a tenant from the template, borrower profiles with guarantors and collateral, loan products, approval and disbursement records, repayment schedules, collections list with SMS reminders, field collection as pending receipts, portfolio and arrears reports, Excel import of an existing loan book. All screens in the Yapesa web and mobile apps.
Done when: a lender imports a real loan book from Excel, records a week of repayments, and the arrears list matches what they believe to be true.
```

### Phase 7: Yapesa SACCO

```text
Phase 7. Build the SACCO module on Fineract: SACCO template, member management with KYC, savings and share accounts, loan products with guarantors, teller screens with end-of-day close and dual approval above a threshold, accounting views (journals, trial balance, statements, period close), dividends per the Phase 5 decision, migration tools with an opening-balance proof report, member mobile views, board dashboard with portfolio at risk.
Done when: a real SACCO's month is entered and the trial balance matches their figures; interest accrual for a month matches their own calculation; a teller day balances to the shilling and a deliberate discrepancy is caught; a migration reconciles.
```

### Phase 8: Hardening for go-live

```text
Phase 8. Prepare for real users: production setup as code, automated daily backups, monitoring and uptime alerts, rate limits, a dependency audit, and short runbooks for an outage and a restore.
Done when: the system runs in production with backups and alerts working, and a restore has been done once.
```

## Hosting stages and open questions

Hosting costs nothing until real records arrive. These figures are estimates for planning, at UGX 3,700 to the dollar; check current prices before committing.

| Stage                          | What runs where                                                                                                                                                       | Monthly cost               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Building and demos             | Everything in Docker locally; current web/API development deployment on Render Free (founder-approved); Supabase free tier; GitHub, Expo EAS and Sentry free tiers    | USD 0                      |
| Groups pilot with real records | Supabase Pro (automatic backups)                                                                                                                                      | About USD 25               |
| First lender or SACCO live     | Add AWS: managed PostgreSQL for Fineract plus one server for Fineract and the API. Region: Cape Town or Frankfurt, whichever is faster from Kampala in a one-day test | About USD 115–150 in total |

Once Fencher Technologies is registered, apply to the AWS, Google and Microsoft startup credit programmes to offset paid hosting.

### Inputs needed from the founder

These help the build. None of them blocks starting Phase 0.

- [ ] Sample records to test the numbers: one group's cycle (photos of the paper ledger are enough) and one SACCO's month of transactions.
- [ ] One SACCO's dividend calculation as a worked example.
- [ ] An Africa's Talking account (the sandbox is free).
- [ ] A Google Play developer account when ready to publish; Apple later.

Later, before onboarding real customers, not needed to build: regulator report formats and data-protection registration in each country.
