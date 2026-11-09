# Local Fineract staff identity proof

The pinned, unmodified Apache Fineract 1.12.0 service is exercised after its Docker
health check in the `local-stack` CI job:

```sh
FINERACT_LOCAL_IDENTITY_PROOF=1 node --env-file=.env scripts/verify-fineract-staff.mjs
```

The script accepts only the loopback HTTPS Compose endpoint on port 8443. Its
self-signed certificate exception is limited to that local endpoint; this is not a
production client or a hosted configuration. Explicit local-proof mode is required.
The upstream default tenant and its documented local bootstrap account provision
only the isolated fixtures. `FINERACT_DEFAULT_MASTER_PASSWORD` protects tenant
configuration and is not the bootstrap user's login password. Optional local
bootstrap credentials stay in the process environment. Generated staff passwords
and authentication keys stay in memory and never appear in output or artifacts.

The proof creates two distinct staff users, each with a custom role. The writer
receives only READ_CLIENT, CREATE_CLIENT and READ_AUDIT; the reader receives only
READ_CLIENT. The test verifies the actual selected permission set rather than
assuming role creation applied it. A pending, nonfinancial test client is created
as the writer, then read as the reader. The reader must be denied client creation
and user administration. The client's permanent Fineract audit must name the
individual writer, not the provisioning administrator. Reassigning the writer to
the reader role must remove write authority from those same staff credentials.
An unknown tenant header must fail without falling back to the default tenant.

No financial product, account, loan, share or ledger balance is created. User
creation sets sendPasswordToEmail=false, with addresses under example.invalid.
Only known fixture IDs are cleaned up; no pre-existing users/roles/clients are
searched for or deleted. Fineract's own immutable command audit remains. The
summary prints proof flags only, with no credentials or request/response bodies.
Failures preserve safe endpoint/status/validation-field diagnostics.

This proves local per-user API calls, role enforcement and audit attribution in
the existing default tenant. It does not prove two populated tenants, dynamic
tenant provisioning, a hosted credential store, Yapesa/Fineract account linking,
maker-checker financial policies, SACCO/lender products, migration balances or
actual dividends. Those remain separate acceptance work, with worked customer
examples and an approved hosted environment. The application must never replace
SACCO/lender accounting with the Groups ledger or route money commands through a
shared administrator account.

Pinned upstream references:

- [Authentication API](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/java/org/apache/fineract/infrastructure/security/api/AuthenticationApiResource.java)
- [User API contract](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/java/org/apache/fineract/useradministration/api/UsersApiResourceSwagger.java)
- [User validation](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/java/org/apache/fineract/useradministration/service/UserDataValidator.java)
- [Role permissions API](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/java/org/apache/fineract/useradministration/api/RolesApiResource.java)
- [Audit API](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/java/org/apache/fineract/commands/api/AuditsApiResource.java)
- [Local integration configuration](https://github.com/apache/fineract/blob/1.12.0/integration-tests/src/test/java/org/apache/fineract/integrationtests/ConfigProperties.java)
