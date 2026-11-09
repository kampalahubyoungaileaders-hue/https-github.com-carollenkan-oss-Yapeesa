import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

// This is deliberately restricted to the disposable test database. It never
// accepts a hosted connection or overwrites an existing database.
const freshCluster = process.argv.includes('--fresh-cluster');
assert(
  process.argv.slice(2).every((arg) => arg === '--fresh-cluster'),
  'Unknown restore option',
);
const url = new URL(process.env.TEST_DB_URL ?? '');
assert(
  ['localhost', '127.0.0.1'].includes(url.hostname),
  'Local test database only',
);
assert.equal(
  url.pathname,
  '/postgres',
  'Expected the disposable Supabase database',
);
assert(
  ['localhost', '127.0.0.1'].includes(
    new URL(process.env.SUPABASE_URL ?? '').hostname,
  ),
  'Local Auth fixtures only',
);
const config = await readFile('supabase/config.toml', 'utf8');
const project = config.match(/^project_id = "([a-z0-9_-]+)"/m)?.[1];
assert(project, 'Expected a known local Supabase project ID');
const container = `supabase_db_${project}`;
const target = `restore_check_${randomBytes(8).toString('hex')}`;
const directory = await mkdtemp(join(tmpdir(), 'yapesa-restore-'));
const source = new pg.Client({ connectionString: url.href });
let restored,
  created = false,
  freshCreated = false;
const freshContainer = `yapesa_recovery_${randomBytes(8).toString('hex')}`;
let bootstrapRole;
const bootstrapPassword = randomBytes(32).toString('base64url');
function command(args, input, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    const chunks = [],
      errors = [];
    let length = 0;
    child.stdout.on('data', (chunk) => {
      length += chunk.length;
      if (length > 128 * 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (errors.reduce((sum, value) => sum + value.length, 0) < 8192)
        errors.push(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(
            new Error(
              `Local ${args[0]} failed (${code}): ${Buffer.concat(errors).toString('utf8').slice(0, 2000)}`,
            ),
          ),
    );
    child.stdin.on('error', () => {
      /* A process exit is reported above. */
    });
    child.stdin.end(input);
  });
}
function docker(args, input, destination = container) {
  return command(
    ['exec', ...(input ? ['-i'] : []), destination, ...args],
    input,
  );
}
async function roleFingerprint(client, excluded = '') {
  const roles = (
    await client.query(
      `select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolvaliduntil::text,rolbypassrls,rolconfig from pg_roles where rolname !~ '^pg_' and rolname<>$1 order by rolname`,
      [excluded],
    )
  ).rows;
  const memberships = (
    await client.query(
      `select r.rolname role,m.rolname member,g.rolname grantor,a.admin_option,a.inherit_option,a.set_option from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member join pg_roles g on g.oid=a.grantor where r.rolname<>$1 and m.rolname<>$1 order by role,member,grantor`,
      [excluded],
    )
  ).rows;
  return { roles, memberships };
}
async function startFreshCluster() {
  // Reuse binaries/extensions, never the source volume or provider bootstrap SQL.
  const image = (
    await command(['inspect', '--format', '{{.Image}}', container])
  )
    .toString()
    .trim();
  assert(
    /^sha256:[a-f0-9]{64}$/.test(image),
    'Expected an immutable local image ID',
  );
  const boot = `set -eu
umask 077
mkdir /tmp/recovery
printf '%s\n' "$YAPESA_RESTORE_PASSWORD" > /tmp/recovery/password
bindir=$(pg_config --bindir)
"$bindir/initdb" -D /tmp/recovery/data -U "$YAPESA_RESTORE_ROLE" --encoding=UTF8 --locale=C.UTF-8 --auth-local=trust --auth-host=scram-sha-256 --pwfile=/tmp/recovery/password >/dev/null
rm /tmp/recovery/password
printf 'host all all 0.0.0.0/0 scram-sha-256\n' >> /tmp/recovery/data/pg_hba.conf
unset YAPESA_RESTORE_PASSWORD
exec "$bindir/postgres" -D /tmp/recovery/data -c listen_addresses='*' -c unix_socket_directories=/tmp -c max_connections=30`;
  // Only this disposable container gets a generated, in-memory bootstrap secret.
  // Docker inherits it by name: it never appears in command arguments or logs.
  await command(
    [
      'run',
      '--detach',
      '--name',
      freshContainer,
      '--user',
      'postgres',
      '--publish',
      '127.0.0.1::5432',
      '--tmpfs',
      '/tmp:rw,nosuid,size=768m',
      '--env',
      'YAPESA_RESTORE_PASSWORD',
      '--env',
      'YAPESA_RESTORE_ROLE',
      '--entrypoint',
      '/bin/sh',
      image,
      '-c',
      boot,
    ],
    undefined,
    {
      ...process.env,
      YAPESA_RESTORE_PASSWORD: bootstrapPassword,
      YAPESA_RESTORE_ROLE: bootstrapRole,
    },
  );
  freshCreated = true;
  const binding = JSON.parse(
    (
      await command([
        'inspect',
        '--format',
        '{{json .NetworkSettings.Ports}}',
        freshContainer,
      ])
    ).toString(),
  )['5432/tcp'];
  assert.equal(binding.length, 1);
  assert.equal(binding[0].HostIp, '127.0.0.1');
  assert(/^\d+$/.test(binding[0].HostPort));
  const connection = {
    host: '127.0.0.1',
    port: Number(binding[0].HostPort),
    user: bootstrapRole,
    password: bootstrapPassword,
    database: 'postgres',
    connectionTimeoutMillis: 2000,
  };
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    const probe = new pg.Client(connection);
    try {
      await probe.connect();
      ready = true;
    } catch {
      /* Initdb is still running. */
    } finally {
      await probe.end();
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert(ready, 'Fresh recovery cluster did not become ready');
  const client = new pg.Client(connection);
  await client.connect();
  try {
    assert.deepEqual(
      (await roleFingerprint(client, bootstrapRole)).roles,
      [],
      'Destination must start without application/provider roles',
    );
  } finally {
    await client.end();
  }
  return connection;
}
const schemas = ['public', 'private', 'auth', 'supabase_migrations'];
const ident = (value) => {
  assert(/^[a-z_][a-z0-9_]*$/.test(value));
  return `"${value}"`;
};
async function fingerprint(client) {
  // Administrators can have different login defaults. Compare canonical SQL and
  // timestamp output, not session-dependent qualification or locale ordering.
  await client.query(
    "select set_config('search_path','pg_catalog',false),set_config('TimeZone','UTC',false),set_config('DateStyle','ISO,YMD',false)",
  );
  const tables = (
    await client.query(
      'select schemaname,tablename from pg_tables where schemaname=any($1) order by schemaname,tablename',
      [schemas],
    )
  ).rows;
  const data = [];
  for (const { schemaname, tablename } of tables) {
    const result = await client.query(
      `select count(*)::text count, encode(extensions.digest(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text collate "C"),''),'sha256'),'hex') digest from ${ident(schemaname)}.${ident(tablename)} t`,
    );
    data.push({ schema: schemaname, table: tablename, ...result.rows[0] });
  }
  const relations = (
    await client.query(
      "select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) owner,array(select x::text from unnest(coalesce(c.relacl,acldefault((case when c.relkind='S' then 's' else 'r' end)::\"char\",c.relowner))) x order by x::text) acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1) and c.relkind in ('r','p','S') order by n.nspname,c.relname",
      [schemas],
    )
  ).rows;
  const functions = (
    await client.query(
      "select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_userbyid(p.proowner) owner,p.prosecdef,array(select x::text from unnest(coalesce(p.proacl,acldefault('f',p.proowner))) x order by x::text) acl,p.proconfig,encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex') definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any($1) and p.prokind='f' order by n.nspname,p.proname,args",
      [['public', 'private']],
    )
  ).rows;
  const policies = (
    await client.query(
      'select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname=any($1) order by schemaname,tablename,policyname',
      [schemas],
    )
  ).rows;
  const triggers = (
    await client.query(
      'select n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1) and not t.tgisinternal order by n.nspname,c.relname,t.tgname',
      [schemas],
    )
  ).rows;
  const constraints = (
    await client.query(
      'select n.nspname,c.relname,k.conname,k.convalidated,k.condeferrable,k.condeferred,pg_get_constraintdef(k.oid) definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1) order by n.nspname,c.relname,k.conname',
      [schemas],
    )
  ).rows;
  // PostgreSQL can flatten associative CHECK expressions when replaying a dump.
  // Reparse checks through PostgreSQL itself, rather than dropping parentheses
  // in application code or weakening the comparison of constraint semantics.
  let currentTable = '';
  for (const constraint of constraints) {
    if (!constraint.definition.startsWith('CHECK ')) continue;
    const table = `${constraint.nspname}.${constraint.relname}`;
    if (table !== currentTable) {
      if (currentTable)
        await client.query(
          'drop table pg_temp.restore_constraint_normalisation',
        );
      await client.query(
        `create temporary table restore_constraint_normalisation (like ${ident(constraint.nspname)}.${ident(constraint.relname)})`,
      );
      currentTable = table;
    }
    await client.query(
      `alter table pg_temp.restore_constraint_normalisation add constraint canonical_check ${constraint.definition}`,
    );
    constraint.definition = (
      await client.query(
        "select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='pg_temp.restore_constraint_normalisation'::regclass and conname='canonical_check'",
      )
    ).rows[0].definition;
    await client.query(
      'alter table pg_temp.restore_constraint_normalisation drop constraint canonical_check',
    );
  }
  if (currentTable)
    await client.query('drop table pg_temp.restore_constraint_normalisation');
  const defaults = (
    await client.query(
      "select pg_get_userbyid(d.defaclrole) role,coalesce(n.nspname,'') schema,d.defaclobjtype,array(select x::text from unnest(d.defaclacl) x order by x::text) acl from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where n.nspname=any($1) or d.defaclnamespace=0 order by role,schema,d.defaclobjtype",
      [schemas],
    )
  ).rows;
  const sequences = (
    await client.query(
      'select schemaname,sequencename,start_value::text,min_value::text,max_value::text,increment_by::text,cycle,cache_size::text,last_value::text from pg_sequences where schemaname=any($1) order by schemaname,sequencename',
      [schemas],
    )
  ).rows;
  const indexes = (
    await client.query(
      'select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname=any($1) order by schemaname,tablename,indexname',
      [schemas],
    )
  ).rows;
  return {
    data,
    relations,
    functions,
    policies,
    triggers,
    constraints,
    defaults,
    sequences,
    indexes,
  };
}
try {
  await source.connect();
  await source.query('begin isolation level repeatable read');
  const snapshot = (await source.query('select pg_export_snapshot() snapshot'))
    .rows[0].snapshot;
  assert(/^[A-Fa-f0-9-]+$/.test(snapshot));
  const expected = await fingerprint(source);
  const expectedRoles = await roleFingerprint(source);
  bootstrapRole = (
    await source.query('select rolname from pg_roles where oid=10')
  ).rows[0]?.rolname;
  assert(
    /^[a-z_][a-z0-9_]*$/.test(bootstrapRole),
    'Expected a conventional local bootstrap role',
  );
  const rolesArchive = freshCluster
    ? await docker([
        'pg_dumpall',
        '-U',
        'supabase_admin',
        '--roles-only',
        '--no-role-passwords',
        '--no-password',
      ])
    : null;
  if (rolesArchive) {
    assert(
      !/\bPASSWORD\s+'/.test(rolesArchive.toString()),
      'Role passwords must be excluded',
    );
    await writeFile(join(directory, 'roles.sql'), rolesArchive, {
      mode: 0o600,
    });
  }
  assert(
    expected.data.some(
      (t) =>
        t.schema === 'public' && t.table === 'journal' && BigInt(t.count) > 0n,
    ),
    'Meaningful financial test fixtures must exist before the restore check',
  );
  const archive = await docker([
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '--format=custom',
    '--no-password',
    `--snapshot=${snapshot}`,
  ]);
  assert.equal(archive.subarray(0, 5).toString(), 'PGDMP');
  const file = join(directory, 'local-fixtures.dump');
  await writeFile(file, archive, { mode: 0o600 });
  await source.query('commit');
  // Owners and grants are preserved. --no-owner would silently turn bounded
  // SECURITY DEFINER executors into postgres-owned functions after restoration.
  const contents = (await docker(['pg_restore', '--list'], archive)).toString(
    'utf8',
  );
  assert(
    contents.includes('TABLE public person'),
    'Archive must contain core records',
  );
  let restoreConnection;
  let destination = container;
  let restoreRole = 'supabase_admin';
  if (freshCluster) {
    restoreConnection = await startFreshCluster();
    destination = freshContainer;
    restoreRole = bootstrapRole;
    await docker(
      [
        'psql',
        '-h',
        '/tmp',
        '-U',
        bootstrapRole,
        '-d',
        'postgres',
        '--quiet',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      // OID 10 is PostgreSQL's bootstrap grantor. Preserve that identity rather
      // than weakening role memberships to accommodate a different bootstrap.
      // initdb created it already; replay its ALTER and all other CREATEs.
      Buffer.from(
        rolesArchive
          .toString()
          .split('\n')
          .filter(
            (line) =>
              line !== `CREATE ROLE ${bootstrapRole};` &&
              line !== `CREATE ROLE "${bootstrapRole}";`,
          )
          .join('\n'),
      ),
      destination,
    );
    const roleClient = new pg.Client(restoreConnection);
    await roleClient.connect();
    try {
      assert.deepEqual(
        await roleFingerprint(roleClient),
        expectedRoles,
        'Fresh-cluster role flags, settings and memberships must match',
      );
    } finally {
      await roleClient.end();
    }
  }
  await docker(
    [
      'createdb',
      ...(freshCluster ? ['-h', '/tmp'] : []),
      '-U',
      restoreRole,
      '--template=template0',
      target,
    ],
    undefined,
    destination,
  );
  created = true;
  if (/\bSCHEMA - public\b/.test(contents))
    await docker(
      [
        'psql',
        ...(freshCluster ? ['-h', '/tmp'] : []),
        '-U',
        restoreRole,
        '-d',
        target,
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        'DROP SCHEMA IF EXISTS public CASCADE',
      ],
      undefined,
      destination,
    );
  await docker(
    [
      'pg_restore',
      ...(freshCluster ? ['-h', '/tmp'] : []),
      '-U',
      restoreRole,
      '-d',
      target,
      '--exit-on-error',
      '--no-password',
    ],
    await readFile(file),
    destination,
  );
  const restoreUrl = new URL(url.href);
  restoreUrl.pathname = `/${target}`;
  restored = new pg.Client(
    freshCluster
      ? { ...restoreConnection, database: target }
      : { connectionString: restoreUrl.href },
  );
  await restored.connect();
  assert.deepEqual(
    await fingerprint(restored),
    expected,
    'Restored records, RLS, owners, grants, functions and immutable triggers must match the same backup snapshot',
  );
  const journal = await restored.query(
    "select count(*)::text unbalanced from (select journal_id from public.journal_line group by journal_id having sum(case when side='debit' then amount else -amount end)<>0) checks",
  );
  assert.equal(
    journal.rows[0].unbalanced,
    '0',
    'Restored journal must balance',
  );
  const permissions = await restored.query(
    "select has_table_privilege('authenticated','public.journal','INSERT') client_write,has_table_privilege('anon','public.journal','SELECT') anonymous_read",
  );
  assert.deepEqual(permissions.rows, [
    { client_write: false, anonymous_read: false },
  ]);
  await assert.rejects(
    () =>
      restored.query(
        'update public.journal set id=id where id=(select id from public.journal limit 1)',
      ),
    (error) => error.code === '55000',
  );
  const actor = (
    await restored.query(
      "select s.id session_id,s.user_id,p.id person_id,m.organisation_id from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.status::text='verified' join public.person p on p.auth_user_id=s.user_id join public.membership m on m.person_id=p.id where s.aal::text='aal2' and (s.not_after is null or s.not_after>now()) and m.role in ('secretary','treasurer','chair') and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()) and exists(select 1 from public.journal j where j.organisation_id=m.organisation_id) order by s.created_at desc,m.organisation_id limit 1",
    )
  ).rows[0];
  assert(actor, 'An actual verified officer test session must exist');
  const other = (
    await restored.query(
      "select o.id from public.organisation o where o.type='group' and o.id<>$1 and not exists(select 1 from public.membership m where m.person_id=$2 and m.organisation_id=o.id and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())) and exists(select 1 from public.journal j where j.organisation_id=o.id) order by o.id limit 1",
      [actor.organisation_id, actor.person_id],
    )
  ).rows[0];
  assert(other, 'A separate test organisation must exist');
  await restored.query('begin');
  try {
    await restored.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: actor.user_id,
        session_id: actor.session_id,
        aal: 'aal2',
        role: 'authenticated',
      }),
    ]);
    await restored.query('set local role authenticated');
    const own = await restored.query(
      'select count(*)::text count from public.journal where organisation_id=$1',
      [actor.organisation_id],
    );
    assert(
      BigInt(own.rows[0].count) > 0n,
      'Restored verified officer must retain own organisation access',
    );
    assert.equal(
      (
        await restored.query(
          'select count(*)::text count from public.journal where organisation_id=$1',
          [other.id],
        )
      ).rows[0].count,
      '0',
      'Restored RLS must hide unrelated journals',
    );
  } finally {
    await restored.query('rollback');
  }
  console.log(
    JSON.stringify({
      proof: freshCluster
        ? 'local-fresh-cluster-restore'
        : 'local-database-restore',
      freshCluster,
      ...(freshCluster
        ? {
            rolesAndMembershipsMatched: true,
            rolePasswordsExcluded: true,
            sourceImageReusedWithoutSourceVolumes: true,
          }
        : {}),
      tables: expected.data.length,
      immutableTriggers: expected.triggers.length,
      rowPolicies: expected.policies.length,
      archiveBytes: archive.length,
      archiveSha256: createHash('sha256').update(archive).digest('hex'),
      recordsAndSecurityMatched: true,
      journalBalanced: true,
      immutableWritesRejected: true,
      restoredOfficerIsolationVerified: true,
      limitation: freshCluster
        ? 'Disposable empty cluster using the local source image; hosted recovery, off-site retention, external secrets and service configuration remain unverified.'
        : 'Disposable database in the same cluster; hosted backups and fresh-cluster role restoration remain unverified.',
    }),
  );
} finally {
  try {
    try {
      if (restored) await restored.end();
    } finally {
      try {
        await source.query('rollback');
      } catch {
        /* Connection may not have opened. */
      }
      await source.end();
    }
  } finally {
    try {
      if (freshCreated)
        await command(['rm', '--force', '--volumes', freshContainer]);
      if (created && !freshCluster)
        await docker(['dropdb', '-U', 'supabase_admin', '--if-exists', target]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
