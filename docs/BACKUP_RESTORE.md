# Backup and restore verification

The local proof runs after disposable integration fixtures and before browser tests:

```sh
node --env-file=.env scripts/verify-local-restore.mjs
```

It refuses hosted URLs and requires a local Supabase test database. It exports a
repeatable-read snapshot, takes a PostgreSQL custom-format pg_dump from that same
snapshot, writes a private temporary archive and restores into a uniquely named,
new database in the local test cluster. It never overwrites the source database.
The temporary archive and destination database are removed after verification.
No archive containing Auth or gateway data is uploaded as a CI artifact.

Fingerprint sessions use the same catalog-only search path, UTC/ISO timestamp
format and C ordering, so login defaults cannot change SQL display or row order.
PostgreSQL itself reparses CHECK expressions in empty temporary tables to
normalize its dump/restore expression formatting; no application rows or source
constraints are changed.

Verification compares every row's content through SHA-256 fingerprints for public,
private, Auth and migration-history tables. It also compares RLS policies, relation
owners and effective grants (including implicit owner privileges), private/public function definitions and owners, and immutable
triggers. Restored journal lines must still balance and anonymous/client journal
privileges must remain restricted. An actual restored officer session must retain
its own journal access and see no journals from an unrelated group. Even the
restore administrator must be rejected when attempting to edit an immutable
journal. Restoration uses the disposable container’s existing database administrator so
Supabase-managed object owners can be preserved without granting new privileges
to application users. Owners and grants are deliberately preserved;
restoring with --no-owner could change the security boundary of bounded functions.

An additional CI step restores into an **empty, independent cluster**:

```sh
node --env-file=.env scripts/verify-local-restore.mjs --fresh-cluster
```

This mode reuses the source container's immutable image ID for compatible
PostgreSQL/extension binaries, but mounts no source volume and bypasses provider
initialization scripts. `initdb` creates a new cluster with only PostgreSQL's
built-in roles and the source's bootstrap administrator identity (OID 10). The
test asserts that no other application/provider roles exist before restoring
them. PostgreSQL role grants depend on the bootstrap grantor identity: changing
its name and then replaying GRANTED BY statements can fail. The role manifest
omits only that administrator's already-completed CREATE ROLE; its exact ALTER
settings and all other role creation/grants are replayed and compared.

A separate `pg_dumpall --roles-only --no-role-passwords` manifest restores role
flags, settings and memberships. Their fingerprints must match the source before
restoring the database. Passwords are excluded: database login credentials must
be provisioned separately during a real recovery. The generated test bootstrap
password is passed by environment name, never as a command argument or log; its
only temporary password file is private and removed immediately after initdb.
The container binds a random port on 127.0.0.1, requires SCRAM for TCP connections
and is removed with its volumes after the proof. Database archives and the role
manifest remain private temporary files and are never CI artifacts.

The same data/security comparisons, balanced journal, immutable-write rejection
and restored officer isolation checks run in both modes. The independent-cluster
proof exercises SQL/database recovery only. It does not restore Supabase's hosted
control plane, Auth service configuration, signing keys, SMS credentials, external
files, Vault encryption keys or other external secrets. It does not configure
production scheduling or off-site retention. A real recovery also needs a
compatible extension inventory, separately protected service/credential bootstrap,
and application/API verification against the isolated hosted destination.

Before live customer records, the project owner must provide an approved hosted
backup path, define retention and off-site encrypted storage, and run a restore
into an isolated recovery project. The free development Supabase instance has not
been represented as having paid automatic backups. No production connection
password is available to this workflow, and none is extracted from server files.

For an actual outage, stop new writes, identify the last known-good backup and its
migration/source revision, restore into an isolated destination, reconcile counts,
journal totals and RLS/actor permissions, then verify the web/API against that
recovery destination before switching traffic. Preserve the old instance for
investigation and record the recovery point and elapsed recovery time.

References: [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html),
[pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html),
[snapshot synchronization](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION).

## Native SACCO database recovery proof

After the disposable Fineract financial acceptance check, CI also runs:

```sh
FINERACT_LOCAL_RESTORE_PROOF=1 node --env-file=.env scripts/verify-fineract-restore.mjs
```

This is restricted to the exact local `yapesa-fineract` Compose database container.
It has no hosted-connection option. It temporarily stops the local engine to
quiesce jobs and sequences, and restarts it in cleanup. It takes separate
repeatable-read snapshots and custom-format dumps of `fineract_tenants` and
`fineract_default`. Dumps stay in process memory; they are never uploaded as
artifacts. The default tenant must already contain financial journals.

Recovery uses the source database's immutable PostgreSQL image in a fresh
container with a separate temporary filesystem and a random, loopback-only port.
No source volume is mounted. The generated recovery password is passed by
inherited environment name, never as an argument or output. The source's single
local bootstrap role is required; additional operator roles are deliberately
unsupported by this disposable proof rather than silently omitted.

For both databases, the proof compares exact per-table row counts and SHA-256
content fingerprints, owners/grants/RLS flags, column definitions, constraints,
indexes, sequences, user functions, views and user triggers. Comparison failures
print hashes, not source rows or raw restore errors. The recovery container and
its temporary data are removed even when checks fail. Tenant registry secrets and
staff password hashes are therefore never published in CI logs or artifacts.

This exercises SQL/database recovery only. A full operational drill still needs
the matching separately protected Fineract master encryption key, credentials,
compatible engine and API startup, individual staff authentication, reconciliation,
and an isolated hosted target. It does not provide encrypted off-site storage,
backup scheduling, retention, alerting or recovery-time guarantees.
