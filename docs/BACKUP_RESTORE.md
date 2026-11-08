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

Verification compares every row's content through SHA-256 fingerprints for public,
private, Auth and migration-history tables. It also compares RLS policies, relation
owners and grants, private/public function definitions and owners, and immutable
triggers. Restored journal lines must still balance and anonymous/client journal
privileges must remain restricted. An actual restored officer session must retain
its own journal access and see no journals from an unrelated group. Even the
restore administrator must be rejected when attempting to edit an immutable
journal. Owners and grants are deliberately preserved;
restoring with --no-owner could change the security boundary of bounded functions.

This proves a disposable database restore within a cluster that already has its
roles and extensions. It does not prove a fresh-cluster disaster recovery or a
hosted production backup. PostgreSQL roles are cluster-wide and need a separately
protected role/bootstrap manifest before a fresh-cluster restore. A real deployment
also requires compatible extension versions, external service configuration and
application secrets, with credentials kept out of ordinary backups and logs.

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
