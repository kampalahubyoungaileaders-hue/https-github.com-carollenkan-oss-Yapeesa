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
  created = false;
function docker(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['exec', ...(input ? ['-i'] : []), container, ...args],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
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
const schemas = ['public', 'private', 'auth', 'supabase_migrations'];
const ident = (value) => {
  assert(/^[a-z_][a-z0-9_]*$/.test(value));
  return `"${value}"`;
};
async function fingerprint(client) {
  const tables = (
    await client.query(
      'select schemaname,tablename from pg_tables where schemaname=any($1) order by schemaname,tablename',
      [schemas],
    )
  ).rows;
  const data = [];
  for (const { schemaname, tablename } of tables) {
    const result = await client.query(
      `select count(*)::text count, encode(extensions.digest(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),''),'sha256'),'hex') digest from ${ident(schemaname)}.${ident(tablename)} t`,
    );
    data.push({ schema: schemaname, table: tablename, ...result.rows[0] });
  }
  const relations = (
    await client.query(
      "select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) owner,array(select x::text from unnest(c.relacl) x order by x::text) acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1) and c.relkind in ('r','p','S') order by n.nspname,c.relname",
      [schemas],
    )
  ).rows;
  const functions = (
    await client.query(
      "select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_userbyid(p.proowner) owner,p.prosecdef,array(select x::text from unnest(p.proacl) x order by x::text) acl,p.proconfig,encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex') definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any($1) and p.prokind='f' order by n.nspname,p.proname,args",
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
  await docker(['createdb', '-U', 'postgres', '--template=template0', target]);
  created = true;
  const contents = (await docker(['pg_restore', '--list'], archive)).toString(
    'utf8',
  );
  assert(
    contents.includes('TABLE public person'),
    'Archive must contain core records',
  );
  if (/\bSCHEMA - public\b/.test(contents))
    await docker([
      'psql',
      '-U',
      'postgres',
      '-d',
      target,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'DROP SCHEMA IF EXISTS public CASCADE',
    ]);
  await docker(
    [
      'pg_restore',
      '-U',
      'supabase_admin',
      '-d',
      target,
      '--exit-on-error',
      '--no-password',
    ],
    await readFile(file),
  );
  const restoreUrl = new URL(url.href);
  restoreUrl.pathname = `/${target}`;
  restored = new pg.Client({ connectionString: restoreUrl.href });
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
      proof: 'local-database-restore',
      tables: expected.data.length,
      immutableTriggers: expected.triggers.length,
      rowPolicies: expected.policies.length,
      archiveBytes: archive.length,
      archiveSha256: createHash('sha256').update(archive).digest('hex'),
      recordsAndSecurityMatched: true,
      journalBalanced: true,
      immutableWritesRejected: true,
      restoredOfficerIsolationVerified: true,
      limitation:
        'Disposable database in the same cluster; hosted backups and fresh-cluster role restoration remain unverified.',
    }),
  );
} finally {
  if (restored) await restored.end();
  try {
    await source.query('rollback');
  } catch {
    /* Connection may not have opened. */
  }
  await source.end();
  if (created)
    await docker(['dropdb', '-U', 'postgres', '--if-exists', target]);
  await rm(directory, { recursive: true, force: true });
}
