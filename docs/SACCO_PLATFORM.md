# SACCO platform work in progress

SACCO accounts, balances, interest, shares, dividends, loans and accounting journals
belong exclusively to unmodified Apache Fineract 1.12.0. Groups ledger functions
are never a fallback. This document records implementation scope; it is not a
claim that SACCO acceptance or production onboarding is complete.

## Connection and staff boundary

`FINERACT_INSTANCES` is a server-only JSON map of approved instance keys to HTTPS
base URLs ending in `/fineract-provider/api/v1/`. SACCO registration binds exactly
one unique instance/tenant pair and its canonical endpoint hash; URLs cannot be
supplied by a browser or silently remapped by a server-setting change. No default
tenant is accepted outside explicitly local tests. Hosting remains unprovisioned.

Example shape (replace only in server settings, never with credentials in source):

```json
{
  "sacco_cluster": {
    "url": "https://engine.example.invalid/fineract-provider/api/v1/"
  }
}
```

Each verified staff member connects their own Fineract app user once. A Fineract
user cannot represent two Yapesa people in the same SACCO. Shared ALL_FUNCTIONS
bootstrap accounts are rejected by the customer API. The password is encrypted
using AES-256-GCM under a purpose-derived server key, with the person, SACCO,
connection revision and Fineract user ID authenticated as associated data. The
credential is never returned by a Yapesa browser endpoint. RPC access to encrypted
links also requires the server gateway and the verified person's current SACCO
membership. A manager cannot read another person's credential.

Existing `SESSION_COOKIE_KEY` is the key-encryption root; preserve it separately
from database backups. Its rotation requires staff relinking. Credential changes
are audited without copying plaintext or ciphertext into the audit log. Staff
roles must also be maintained in Fineract; Yapesa role revocation blocks the API
immediately but is not a substitute for revoking direct engine access. The engine
must be isolated from customer networks in production.

## Command controls

The API uses each linked staff member's credentials, current Yapesa membership and
Fineract permissions. Mutating customer commands require global maker-checker and
the relevant native permission's maker-checker setting. The API never silently
posts immediately when those controls are absent. Native checker permissions and
Fineract's prohibition on self-checking remain authoritative. This conservative
first policy requires independent checking for all supported mutations, not just
large amounts; amount thresholds are not invented.

A stable UUID is bound to the SACCO, staff identity, operation and canonical
payload hash, then passed as Fineract's `Idempotency-Key`. There are no automatic
mutation retries. Transport failures and conflicting in-progress commands retain
an uncertain outcome. Only an explicit retry of the same reference and exact
payload can reconcile through Fineract's native idempotency. Supabase stores
integration references and outcomes, not duplicate SACCO money records.

Fineract JSON number tokens are preserved as strings by Node 24's original-source
JSON reviver. Amount conversion uses integer arithmetic and rejects fractional
minor units rather than rounding silently. Native account currency/precision is
authoritative; the Groups share-out engine never calculates SACCO dividends.

## Acceptance still to finish

- Running-engine tests for the account, loan, dividend and maker-checker contracts.
- SACCO web workspace, account forms, reports, teller reconciliation and migrations.
- Product templates and automatic tenant provisioning with isolation proof.
- Member self-service linking, KYC file handling and operational staff lifecycle.
- A supplied real SACCO month, dividend calculation and opening-balance migration,
  compared to Fineract's records; teller discrepancies must be detected.
- Approved hosting, protected backups/recovery and operational monitoring.

No hosted SACCO, customer account, real financial fixture, SMS or payment transfer
is created by this work. Offline workflows and native Android builds remain deferred.

Pinned upstream contracts:

- [Idempotency](https://github.com/apache/fineract/blob/1.12.0/fineract-doc/src/docs/en/chapters/architecture/idempotency.adoc)
- [Command wrappers](https://github.com/apache/fineract/blob/1.12.0/fineract-core/src/main/java/org/apache/fineract/commands/service/CommandWrapperBuilder.java)
- [Account API](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/java/org/apache/fineract/portfolio/accounts/api/AccountsApiResource.java)
- [Maker-checker API](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/java/org/apache/fineract/commands/api/MakercheckersApiResource.java)
- [Permission controls](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/java/org/apache/fineract/useradministration/api/PermissionsApiResource.java)

## Native share approval blocker (12 November 2026)

The disposable running Fineract 1.12.0 role catalogue does not include
`CREATE_SHAREACCOUNT_CHECKER`, although it includes `CREATE_SHAREACCOUNT`.
The attempted native share/dividend acceptance stops before creating financial
fixtures. Do not grant CHECKER_SUPER_USER or bypass the required approval controls
to make this test pass. Native savings and loan acceptance passed independently.

Share/dividend writes must remain unavailable under the current native-only
maker-checker policy until an approval design is reviewed. A Yapesa-managed
independent approval queue is a possible design change, not an implemented or
accepted replacement. It requires reviewed identity, payload binding, immutable
audits, self-approval denial, revocation and replay/uncertain-outcome handling.
The native dividend approval endpoint uses PUT; approval and dividend posting
are distinct operations.
