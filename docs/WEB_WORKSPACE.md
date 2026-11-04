# Web Groups workspace

Run `pnpm --filter @yapesa/web dev` from the repository root after installing the
locked dependencies. Open http://127.0.0.1:5173. No hosted database, account or
credentials are needed for this preview.

Implemented:

- A responsive workspace with overview, meetings, members and ledger navigation.
- Three selectable sample savings groups and member passbooks.
- Share-purchase entry with cycle-date, integer count and cumulative meeting-limit
  validation. Prices and limits come from each sample group's settings.
- Append-only corrections through linked reversing entries, plus journal inspection.
- Bigint minor-unit calculations, balanced journal lines and currency separation.
- Browser persistence with runtime validation on reload and a visible warning when
  storage is unavailable. Reset requires an explicit confirmation dialog.
- Member/reference/note search and CSV exports with spreadsheet-formula escaping.
- English strings through the shared i18n package; country/currency/time-zone metadata
  on each group; layouts for desktop and 360 px browsers.

## Scope and data boundary

The fixed sample snapshot covers twelve weekly meetings from 15 August to
31 October 2026: 57 fictional people, 58 group memberships and 644 ledger
records. Umoja has 25 members (731 net shares, UGX 3,655,000), Nakawa has 18
(530 net shares, UGX 1,060,000), and Kasubi has 15 (440 net shares,
UGX 4,400,000). Each group includes a linked reversal and corrected purchase.
Some meetings have no purchase for particular members; this does not assert
anything about attendance. Names and figures are synthetic.

The snapshot is deterministic. **Reload fixed sample data** restores its original
figures after browser edits. This version uses `yapesa-web-demo-v2`, leaving any
older v1 browser demo copy untouched. It never seeds the hosted database.

This is an explicitly labelled browser demo. It is not the authoritative Groups
engine. Records stay in this browser; there is no login, server sync, PostgreSQL
posting, RLS, encrypted local storage or multi-user access control. No customer data
should be entered. The financial calculations demonstrated are share purchases
and exact reversals only. Loans, interest, social fund, attendance, approvals and
meeting close are not presented as implemented.

The separate authenticated workspace at `/#live` connects to the user-token API,
RLS-protected share ledger, administration and PDF statements. This demo does not
use those accounts or post sample transactions to them. See `SECURE_WEB.md`.

## Verification

`pnpm check` runs strict types, lint, formatting, property tests, record-validation
tests and production builds. `pnpm test:web` runs Playwright in desktop and 360 px
viewports, exercising navigation, share entry, reload persistence, reversal,
meeting limits, passbook views and CSV export. Install its browser first with
`pnpm exec playwright install chromium` when running locally.

GitHub's `Web browser checks` workflow runs those interaction checks and uploads
screenshots and failure traces. Test results must be read from the corresponding
run; adding a workflow alone is not evidence that it passed.

The Android native source is retained separately for a later local build. There
is no Android native-build workflow.
