import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

// Disposable Compose proof only. Never accepts hosted database credentials,
// exports an archive artifact, or overwrites an existing database/cluster.
assert.equal(process.env.FINERACT_LOCAL_RESTORE_PROOF, '1');
assert(process.env.FINERACT_DB_PASSWORD);
const compose = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infra/fineract/docker-compose.yml',
];
const recoveryName = `yapesa_fineract_recovery_${randomBytes(8).toString('hex')}`;
const password = randomBytes(32).toString('base64url');
let created = false,
  engineStopped = false;
const clients = new Set();
function command(args, input, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    const chunks = [];
    let size = 0;
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 128 * 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    // Upstream SQL/restore diagnostics can contain source rows or secrets.
    // Report the failed operation only; never relay raw stderr.
    child.stderr.resume();
    child.on('error', () =>
      reject(new Error(`Local Docker ${args[0]} unavailable`)),
    );
    child.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`Local Docker ${args[0]} failed (${code})`)),
    );
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
const ident = (name) => '"' + name.replaceAll('"', '""') + '"';
async function connect(config) {
  const client = new pg.Client({ ...config, connectionTimeoutMillis: 5000 });
  await client.connect();
  clients.add(client);
  await client.query(
    "set timezone='UTC'; set datestyle='ISO, YMD'; set intervalstyle='postgres'; set extra_float_digits=3",
  );
  return client;
}
async function fingerprint(client) {
  await client.query('set search_path=pg_catalog');
  const tables = (
    await client.query(`select n.nspname, c.relname, pg_get_userbyid(c.relowner) owner,
    c.relrowsecurity, c.relforcerowsecurity, array(select x::text from unnest(coalesce(c.relacl,acldefault('r',c.relowner))) x order by x::text) grants
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast'
    order by n.nspname collate "C", c.relname collate "C"`)
  ).rows;
  const data = [];
  for (const table of tables) {
    const result =
      await client.query(`select hash from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') hash
      from ${ident(table.nspname)}.${ident(table.relname)} t) fingerprints order by hash collate "C"`);
    data.push({
      ...table,
      rows: String(result.rowCount),
      hash: createHash('sha256')
        .update(JSON.stringify(result.rows))
        .digest('hex'),
    });
  }
  const catalogues = {};
  for (const [name, sql] of Object.entries({
    schemas: `select nspname,pg_get_userbyid(nspowner) owner,array(select x::text from unnest(coalesce(nspacl,acldefault('n',nspowner))) x order by x::text) grants from pg_namespace
      where nspname not in ('pg_catalog','information_schema') and nspname !~ '^pg_' order by nspname`,
    columns: `select table_schema,table_name,column_name,ordinal_position,data_type,udt_schema,udt_name,is_nullable,column_default,is_identity,identity_generation,
      character_maximum_length,numeric_precision,numeric_scale,datetime_precision,collation_schema,collation_name,is_generated,generation_expression,domain_schema,domain_name
      from information_schema.columns where table_schema not in ('pg_catalog','information_schema') order by table_schema,table_name,ordinal_position`,
    constraints: `select n.nspname,c.relname,k.conname,k.contype,k.condeferrable,k.condeferred,k.convalidated,pg_get_constraintdef(k.oid) definition
      from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname not in ('pg_catalog','information_schema') order by n.nspname,c.relname,k.conname`,
    indexes: `select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname not in ('pg_catalog','information_schema') order by schemaname,tablename,indexname`,
    sequences: `select schemaname,sequencename,sequenceowner,data_type::text,start_value::text,min_value::text,max_value::text,increment_by::text,cycle,cache_size::text,last_value::text
      from pg_sequences where schemaname not in ('pg_catalog','information_schema') order by schemaname,sequencename`,
    functions: `select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,array(select x::text from unnest(coalesce(p.proacl,acldefault('f',p.proowner))) x order by x::text) grants
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ('pg_catalog','information_schema') and p.prokind in ('f','p') order by n.nspname,p.proname,arguments`,
    views: `select n.nspname,c.relname,pg_get_userbyid(c.relowner) owner,array(select x::text from unnest(coalesce(c.relacl,acldefault('r',c.relowner))) x order by x::text) grants,pg_get_viewdef(c.oid) definition
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('v','m') and n.nspname not in ('pg_catalog','information_schema') order by n.nspname,c.relname`,
    triggers: `select n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname not in ('pg_catalog','information_schema') order by n.nspname,c.relname,t.tgname`,
    policies: `select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies order by schemaname,tablename,policyname`,
  }))
    catalogues[name] = (await client.query(sql)).rows;
  return { data, catalogues };
}
try {
  const sourceId = (await command([...compose, 'ps', '-q', 'db']))
    .toString()
    .trim();
  assert(/^[a-f0-9]{12,64}$/.test(sourceId));
  const sourceInfo = JSON.parse(
    (await command(['inspect', sourceId])).toString(),
  )[0];
  assert.equal(
    sourceInfo.Config.Labels['com.docker.compose.project'],
    'yapesa-fineract',
  );
  assert.equal(sourceInfo.Config.Labels['com.docker.compose.service'], 'db');
  const image = sourceInfo.Image;
  assert(/^sha256:[a-f0-9]{64}$/.test(image));
  const networks = Object.values(sourceInfo.NetworkSettings.Networks);
  assert.equal(networks.length, 1);
  const host = networks[0].IPAddress;
  assert(/^\d+\.\d+\.\d+\.\d+$/.test(host));
  const sourceConfig = {
    host,
    port: 5432,
    user: 'fineract',
    password: process.env.FINERACT_DB_PASSWORD,
  };
  const registry = await connect({
    ...sourceConfig,
    database: 'fineract_tenants',
  });
  const roles = (
    await registry.query(
      "select rolname from pg_roles where rolname !~ '^pg_' order by rolname",
    )
  ).rows;
  assert.deepEqual(
    roles,
    [{ rolname: 'fineract' }],
    'Only disposable upstream bootstrap role is supported',
  );
  // Freeze native jobs and sequences as well as transaction rows. Database
  // snapshots alone cannot make independently changing sequence state atomic.
  engineStopped = true;
  await command([...compose, 'stop', 'fineract']);
  await command(
    [
      'run',
      '--detach',
      '--name',
      recoveryName,
      '--network',
      'bridge',
      '--publish',
      '127.0.0.1::5432',
      '--tmpfs',
      '/var/lib/postgresql/data:rw,nosuid,size=768m',
      '--env',
      'POSTGRES_USER=fineract',
      '--env',
      'POSTGRES_PASSWORD',
      image,
    ],
    undefined,
    { ...process.env, POSTGRES_PASSWORD: password },
  );
  created = true;
  const info = JSON.parse(
    (await command(['inspect', recoveryName])).toString(),
  )[0];
  const binding = info.NetworkSettings.Ports['5432/tcp'];
  assert.equal(binding.length, 1);
  assert.equal(binding[0].HostIp, '127.0.0.1');
  assert.equal(
    info.Mounts.some(
      (mount) => mount.Type === 'volume' || mount.Type === 'bind',
    ),
    false,
  );
  const destinationConfig = {
    host: '127.0.0.1',
    port: Number(binding[0].HostPort),
    user: 'fineract',
    password,
  };
  let admin;
  const deadline = Date.now() + 60000;
  while (!admin && Date.now() < deadline) {
    try {
      admin = await connect({ ...destinationConfig, database: 'fineract' });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  assert(admin, 'Fresh recovery cluster did not become ready');
  const results = [];
  for (const database of ['fineract_tenants', 'fineract_default']) {
    const source =
      database === 'fineract_tenants'
        ? registry
        : await connect({ ...sourceConfig, database });
    await source.query('begin isolation level repeatable read read only');
    const snapshot = (
      await source.query('select pg_export_snapshot() snapshot')
    ).rows[0].snapshot;
    assert(/^[A-F0-9-]+$/i.test(snapshot));
    const expected = await fingerprint(source);
    assert(expected.data.length > 0, 'No meaningful native schema');
    if (database === 'fineract_default') {
      const journal = expected.data.find(
        (t) => t.relname === 'acc_gl_journal_entry',
      );
      assert(
        journal && BigInt(journal.rows) > 0n,
        'Financial proof must run before recovery proof',
      );
    }
    const archive = await command([
      'exec',
      sourceId,
      'pg_dump',
      '-U',
      'fineract',
      '-d',
      database,
      '--format=custom',
      '--snapshot',
      snapshot,
    ]);
    await source.query('commit');
    await admin.query(`create database ${ident(database)} template template0`);
    await command(
      [
        'exec',
        '-i',
        recoveryName,
        'pg_restore',
        '-U',
        'fineract',
        '-d',
        database,
        '--exit-on-error',
        '--single-transaction',
      ],
      archive,
    );
    const restored = await connect({ ...destinationConfig, database });
    const actual = await fingerprint(restored);
    // Hash comparison avoids printing recovered source rows in assertion errors.
    const hash = (value) =>
      createHash('sha256')
        .update(JSON.stringify(value ?? null))
        .digest('hex');
    if (hash(actual) !== hash(expected)) {
      const changedTables = expected.data.filter(
        (table, index) => hash(table) !== hash(actual.data[index]),
      );
      const changedCatalogues = Object.keys(expected.catalogues).filter(
        (key) =>
          hash(expected.catalogues[key]) !== hash(actual.catalogues[key]),
      );
      console.error(
        JSON.stringify({
          database,
          changedTables: changedTables.map((table) => ({
            schema: table.nspname,
            table: table.relname,
            changedKeys: Object.keys(table).filter(
              (key) =>
                hash(table[key]) !==
                hash(
                  actual.data.find(
                    (row) =>
                      row.nspname === table.nspname &&
                      row.relname === table.relname,
                  )?.[key] ?? null,
                ),
            ),
          })),
          changedCatalogues: changedCatalogues.map((category) => {
            const before = expected.catalogues[category],
              after = actual.catalogues[category];
            const index = before.findIndex(
              (row, index) => hash(row) !== hash(after[index] ?? null),
            );
            return {
              category,
              expectedCount: before.length,
              restoredCount: after.length,
              firstChangedIndex: index,
              changedKeys:
                index < 0
                  ? []
                  : Object.keys(before[index]).filter(
                      (key) =>
                        hash(before[index][key]) !==
                        hash(after[index]?.[key] ?? null),
                    ),
            };
          }),
        }),
      );
    }
    results.push({
      database,
      tables: expected.data.length,
      rowsAndSchemaMatched: hash(actual) === hash(expected),
    });
  }
  assert(
    results.every((result) => result.rowsAndSchemaMatched),
    'Restored native data/schema/owners differ; see bounded metadata diagnostics',
  );
  console.log(
    JSON.stringify({
      proof: 'local-fineract-independent-cluster-restore',
      databases: results,
      sourceVolumeShared: false,
      archivesUploaded: false,
      messagesSent: 0,
      limitation:
        'Disposable database recovery only; engine/API startup, hosted credentials, encryption-key recovery, scheduled encrypted off-site backups and operational recovery remain separate acceptance.',
    }),
  );
} finally {
  for (const client of clients) await client.end().catch(() => {});
  try {
    if (created) await command(['rm', '--force', '--volumes', recoveryName]);
  } finally {
    if (engineStopped) await command([...compose, 'start', 'fineract']);
  }
}
