# Named tenant and lender-template spike

Phase 5 requires a tenant/template proof before self-serve Lenders onboarding.
The pinned unmodified Fineract 1.12.0 tree has no tenant-creation REST resource.
Its native tenant registry and startup migrator are the provisioning boundary.
The implementation here is a **local privileged operator acceptance test**, not
an HTTP provisioning service or a hosted onboarding release.

```sh
FINERACT_LOCAL_TENANT_PROOF=1 node --env-file=.env --import tsx scripts/verify-fineract-tenants.mjs
```

Run after the local stack's existing financial and recovery checks. It requires
the exact `yapesa-fineract` Compose database, generated development credentials and
loopback engine. There is no hosted URL, customer-file or existing-tenant option.

## Verified contracts required by the test

1. Pause the local engine. Create two randomly named empty PostgreSQL databases,
   each with a distinct generated login, owner and password. Neither login has
   superuser, role-creation, database-creation, replication or RLS-bypass rights.
   Revoke PUBLIC access to each new database.
2. Register only the new connection/tenant metadata in Fineract's existing tenant
   registry. Use its encrypted password format and the native master-password hash.
   Registry IDs are allocated under an advisory transaction lock; the default
   tenant and financial tables are not rewritten.
3. Restart the engine so **Fineract's own Liquibase migrations** create both native
   schemas. The new databases are not clones of another customer's tenant.
4. Rotate each new tenant's bootstrap password. Apply the versioned cash chart,
   flat/declining loan products and restricted officer/manager roles through the
   native API. Activate native maker-checker after setup and verify its settings.
5. Use overlapping native client IDs with different synthetic profiles. Each staff
   account must read its own tenant and fail authentication in the other tenant.
   A valid database login must also be denied connection to the other database.
6. Confirm that no financial journals were created. Cleanup pauses the engine,
   removes only this run's random test configuration/databases/roles, and restarts
   the original service. Cleanup refuses to delete unexpected financial entries.

The template in `infra/templates/lender-v1.json` defines configuration structure,
account classifications and role permissions. The product builder requires explicit
currency, precision, principal, rates, frequencies, amortisation, day conventions,
processing strategy and charges. It rejects missing terms, numeric money values,
fractional minor units and unexpected mapping overrides. The first version is an
explicitly selected cash-accounting configuration, not an accrual template.

The proof uses labelled one-month, 100,000 UGX, 1% products and an explicit empty
charge list as disposable protocol fixtures. These values are not customer defaults
or accepted lending policy. Product creation is not a full declining-loan lifecycle
or real loan-book acceptance.

## Native password compatibility

`fineract-tenant-format.ts` matches the pinned upstream EncryptionUtil format:
PBKDF2-HMAC-SHA1, its specified iteration count, and AES-CBC with IV/salt prefix.
The upstream Java decryption vector is tested locally and native startup must
successfully decrypt each new database password. This is compatibility with the
native registry; it is not an authenticated-envelope design. Yapesa staff password
envelopes retain their separate AES-GCM implementation. Registry access and the
master key remain privileged operator responsibilities. No new crypto dependency
or Fineract code/schema fork is introduced.

The operator session suppresses statement/parameter logging before password DDL;
script errors never relay raw SQL, passwords, ciphertext or upstream response
bodies. No password is passed in shell arguments or printed as test evidence.

## Remaining production work

A hosted implementation needs an isolated operator worker, approved infrastructure,
a durable request/step ledger, exclusive provisioning leases, interrupted-outcome
reconciliation, secret retention/rotation, organisation/connection binding, staff
identity synchronisation, template upgrades and separately approved customer terms.
Do not give the public API Docker access or registry-administrator credentials.
No self-serve sign-up path is enabled by this spike. SACCO products, real loan-book
migration and the supplied financial examples remain separate acceptance.

Pinned upstream contracts:

- [Native tenant registry](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/resources/db/changelog/tenant-store/parts/0001_initial_schema.xml)
- [Startup tenant upgrades](https://github.com/apache/fineract/blob/1.12.0/fineract-provider/src/main/java/org/apache/fineract/infrastructure/core/service/migration/TenantDatabaseUpgradeService.java)
- [Native password encryptor](https://github.com/apache/fineract/blob/1.12.0/fineract-core/src/main/java/org/apache/fineract/infrastructure/core/service/database/DatabasePasswordEncryptor.java)
- [Native encryption format and test](https://github.com/apache/fineract/blob/1.12.0/fineract-core/src/test/java/org/apache/fineract/infrastructure/security/utils/EncryptionUtilTest.java)

## Tenant-key setting and existing local volumes

The native properties distinguish `fineract.tenant.master-password`
(`FINERACT_DEFAULT_TENANTDB_MASTER_PASSWORD`) from the database fallback master
setting. Runtime acceptance exposed that the original Compose file only set the
latter; the tenant registry consequently used the upstream default key.

New development environments now explicitly map `FINERACT_TENANT_MASTER_PASSWORD`
to the actual native tenant setting. Existing ignored `.env` files without that
variable retain the historical native key via the Compose fallback, so this
change does not silently rotate or invalidate their registry ciphertext. The
operator test compares its selected key with the running container privately
before writing anything. Recovery needs this actual tenant key, not merely the
older database-fallback variable.

Do not add/change the tenant-key value on an already-initialised registry by
copying the new example value. That requires a separately verified offline
rotation of encrypted connection records and native master-password hashes.
No existing volume is deleted or automatically re-encrypted here. Example keys
remain development-only; hosted operation needs separately protected secrets.
