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
Fineract permissions. Savings and loan mutations require global maker-checker and the relevant native
permission's maker-checker setting. The explicitly listed share/dividend operations
use the independently reviewed Yapesa queue described below. The API never silently
posts immediately when those controls are absent. Native checker permissions and
Fineract's prohibition on self-checking remain authoritative. The policy requires independent checking for all supported mutations, not just
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

- Expanded running-engine acceptance beyond the disposable cash/loan/share proof.
- Executable reports, teller reconciliation and customer-record migrations.
- Product templates and automatic tenant provisioning with isolation proof.
- Member self-service linking, KYC file handling and operational staff lifecycle.
- A supplied real SACCO month, dividend calculation and opening-balance migration,
  compared to Fineract's records; teller discrepancies must be detected.
- Approved hosting, protected backups/recovery and operational monitoring.

No hosted SACCO, customer account, real financial fixture, SMS or payment transfer
is created by this work. Offline workflows and native Android builds remain deferred.

The web workspace includes native account/loan forms, approvals, journal reads
and a product-scoped dividend posting view. The latter shows member allocations,
their native posting status and savings transaction references. It does not run
the tenant-wide dividend job. See [SYSTEM_ACCEPTANCE.md](SYSTEM_ACCEPTANCE.md)
for the full remaining scope and supplied-record requirements.

Dividend reads require the native `READ_DIVIDEND_SHAREPRODUCT` permission as well
as Yapesa manager/accountant access. Yapesa verifies the payout belongs to the
selected product because the pinned native allocation endpoint ignores that URL
parameter. Allocation pages are limited to 50 rows and can be paged in the web
view. Parent validation is bounded to 1,000 payout records per product; a truncated
parent lookup fails explicitly rather than claiming a missing dividend.

Pinned upstream contracts:

- [Idempotency](https://github.com/apache/fineract/blob/1.12.0/fineract-doc/src/docs/en/chapters/architecture/idempotency.adoc)
- [Command wrappers](https://github.com/apache/fineract/blob/1.12.0/fineract-core/src/main/java/org/apache/fineract/commands/service/CommandWrapperBuilder.java)
- [Account API](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/java/org/apache/fineract/portfolio/accounts/api/AccountsApiResource.java)
- [Maker-checker API](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/java/org/apache/fineract/commands/api/MakercheckersApiResource.java)
- [Permission controls](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/java/org/apache/fineract/useradministration/api/PermissionsApiResource.java)

## Hybrid approval implementation (development)

The founder approved Yapesa-managed approval for the explicit share/dividend
operation list. Savings/loan commands retain native maker-checker controls.
Independent proposals preserve the exact input and database-generated hash,
organisation, connection version and maker's assigned engine identity. A distinct
verified manager with a different engine identity decides; a rejected proposal
cannot be approved later. The maker then explicitly executes the frozen command
under their own current native permissions. Approval expires after ten minutes.
Yapesa rechecks both people's current roles/identity links, MFA recovery state and
the approver's still-live verified Auth session before the single execution claim.
The manager's native permission is checked when reviewing; the execution actor's
native permission is checked again at execution. Native permission settings for
these operations must be disabled explicitly by engine administration; the API
never silently changes them. Native controls for other operations remain enabled.

Proposals, decisions, dispatch claims and outcomes are immutable and contain no
credentials or duplicate financial journals. The native idempotency key is the
proposal UUID. Only one dispatch claim is allowed; an interrupted attempt remains
blocked for reconciliation, including when the response could not be recorded.
Do not create a replacement command to resolve an uncertain result. Reconciliation
is not yet an automated workflow.

Hosted independent execution is disabled unless FINERACT_GATEWAY_ONLY=true is
set by the operator after verifying private-engine access. This is an operator
attestation, not a network isolation mechanism. Staff must not have a direct
route to Fineract. Loopback-only disposable tests are exempt. No hosted migration
or paid resource is provisioned by this implementation.

Independent approval audit device references identify the verified Auth session,
labelled reference_kind=auth_session in each audit event; they are not physical
device enrollment identifiers.

The proposal also stores a native-command fingerprint covering HTTP method,
resource path and the validated native request body. Review and execution reject
a fingerprint mismatch, including a command-catalog change between deployment
versions. This binds the approved command, not a guarantee that externally
maintained native product terms or account state cannot change.
