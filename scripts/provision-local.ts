import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import pg from 'pg';
import { deriveAuthPassword } from '../apps/api/src/security.js';
import { totp } from './totp.js';
interface Status {
  API_URL: string;
  DB_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}
const { stdout } = await promisify(execFile)(process.execPath, [
  process.env['npm_execpath']!,
  'exec',
  'supabase',
  'status',
  '-o',
  'json',
]);
const status = JSON.parse(stdout) as Status;
for (const value of [status.API_URL, status.DB_URL])
  if (!['127.0.0.1', 'localhost'].includes(new URL(value).hostname))
    throw new Error('Fixture provisioning is restricted to the local stack');
let original = '';
try {
  original = await readFile('.env', 'utf8');
} catch {
  /* fresh checkout */
}
const existing = original.match(/^SUPABASE_URL=(.+)$/m)?.[1];
if (
  existing &&
  !['127.0.0.1', 'localhost'].includes(new URL(existing).hostname)
)
  throw new Error('Refusing to overwrite a hosted environment');
const pepper = randomBytes(32).toString('hex');
const gateway = randomBytes(32).toString('hex');
const key = randomBytes(32).toString('hex');
const pin = String(randomInt(100000, 1000000));
if (process.env['CI'])
  for (const value of [
    status.SERVICE_ROLE_KEY,
    status.DB_URL,
    pepper,
    gateway,
    key,
    pin,
  ])
    console.log(`::add-mask::${value}`);
const db = new pg.Client({ connectionString: status.DB_URL });
await db.connect();
const fixtures: Record<string, string> = {};
async function auth(
  path: string,
  body: unknown,
  token = status.SERVICE_ROLE_KEY,
) {
  const res = await fetch(`${status.API_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: status.ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const failure = (await res.json()) as { error_code?: string; msg?: string };
    throw new Error(
      `Local Auth provisioning failed at ${path.split('?')[0]} (${res.status}, ${failure.error_code ?? 'unknown'}): ${failure.msg ?? ''}`,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}
async function user(label: string, phone: string, secretary: boolean) {
  const password = deriveAuthPassword(phone, pin, pepper);
  const created = await auth('admin/users', {
    phone,
    password,
    phone_confirm: true,
    // Disposable staff fixtures have non-deliverable email labels because the
    // pinned Auth release cannot enrol TOTP for a phone-only account (#2872).
    ...(secretary
      ? { email: `local-${label.toLowerCase()}@example.invalid` }
      : {}),
  });
  const id = String(created['id']);
  const person = await db.query<{ id: string }>(
    'insert into public.person(auth_user_id,display_name,phone,country_code) values($1,$2,$3,$4) returning id',
    [id, `Local ${label}`, phone, 'UG'],
  );
  const personId = person.rows[0]!.id;
  fixtures[`TEST_${label}_PHONE`] = phone;
  fixtures[`TEST_${label}_PERSON`] = personId;
  if (secretary) {
    const token = await auth('token?grant_type=password', { phone, password });
    const access = String(token['access_token']);
    const factor = await auth(
      'factors',
      { factor_type: 'totp', friendly_name: 'Local test authenticator' },
      access,
    );
    const factorId = String(factor['id']);
    const secret = String(
      (factor['totp'] as Record<string, unknown>)['secret'],
    );
    const challenge = await auth(`factors/${factorId}/challenge`, {}, access);
    await auth(
      `factors/${factorId}/verify`,
      { challenge_id: challenge['id'], code: totp(secret) },
      access,
    );
    fixtures[`TEST_${label}_TOTP`] = secret;
    fixtures[`TEST_${label}_FACTOR`] = factorId;
    if (process.env['CI']) console.log(`::add-mask::${secret}`);
  }
  return personId;
}
try {
  const gatewayHash = createHash('sha256').update(gateway).digest('hex');
  await db.query(
    'insert into private.gateway_key(id,key_hash) values(true,$1) on conflict(id) do update set key_hash=excluded.key_hash',
    [gatewayHash],
  );
  const a = await user('A', '+256700000011', true);
  const b = await user('B', '+256700000012', true);
  const m = await user('MEMBER', '+256700000013', false);
  await user('LOCK', '+256700000014', false);
  const admin = await user('ADMIN', '+256700000015', true);
  await user('REC_MEMBER', '+256700000016', false);
  const recoveryStaff = await user('REC_STAFF', '+256700000017', true);
  fixtures['TEST_RECOVERY_CODE'] = '654321';
  const recoveryOrg = await db.query<{ id: string }>(
    "insert into public.organisation(name,type,country_code,currency,time_zone) values('Local recovery group','group','UG','UGX','Africa/Kampala') returning id",
  );
  await db.query(
    "insert into public.membership(person_id,organisation_id,role) values($1,$2,'secretary')",
    [recoveryStaff, recoveryOrg.rows[0]!.id],
  );
  await db.query(
    'insert into public.group_settings(organisation_id) values($1)',
    [recoveryOrg.rows[0]!.id],
  );
  const platform = await db.query<{ id: string }>(
    "insert into public.organisation(name,type,country_code,currency,time_zone) values('Local platform','fencher','UG','UGX','Africa/Kampala') returning id",
  );
  fixtures['TEST_PLATFORM_ORG'] = platform.rows[0]!.id;
  await db.query(
    "insert into public.membership(person_id,organisation_id,role) values($1,$2,'fencher_admin')",
    [admin, fixtures['TEST_PLATFORM_ORG']],
  );
  for (const [label, person, price] of [
    ['A', a, '5000'],
    ['B', b, '10000'],
  ] as const) {
    const org = await db.query<{ id: string }>(
      "insert into public.organisation(name,type,country_code,currency,time_zone) values($1,'group','UG','UGX','Africa/Kampala') returning id",
      [`Local group ${label}`],
    );
    const orgId = org.rows[0]!.id;
    fixtures[`TEST_ORG_${label}`] = orgId;
    await db.query(
      "insert into public.membership(person_id,organisation_id,role) values($1,$2,'secretary'),($1,$2,'member')",
      [person, orgId],
    );
    if (label === 'A')
      await db.query(
        "insert into public.membership(person_id,organisation_id,role) values($1,$2,'member')",
        [m, orgId],
      );
    await db.query(
      'insert into public.group_settings(organisation_id) values($1)',
      [orgId],
    );
    await db.query(
      'insert into public.cycle(organisation_id,starts_on,ends_on,share_price) values($1,current_date-30,current_date+330,$2)',
      [orgId, price],
    );
    await db.query(
      "insert into public.ledger_account(organisation_id,code) values($1,'cash'),($1,'share_capital')",
      [orgId],
    );
  }
  const meetingSecretary = await user(
    'MEETING_SECRETARY',
    '+256700000018',
    true,
  );
  const meetingTreasurer = await user(
    'MEETING_TREASURER',
    '+256700000019',
    true,
  );
  const meetingChair = await user('MEETING_CHAIR', '+256700000020', true);
  const meetingMember = await user('MEETING_MEMBER', '+256700000021', false);
  const meetingAdmin = await user('MEETING_ADMIN', '+256700000022', true);
  await db.query(
    "insert into public.membership(person_id,organisation_id,role) values($1,$2,'fencher_admin')",
    [meetingAdmin, fixtures['TEST_PLATFORM_ORG']],
  );
  for (const label of [
    'INTEGRATION',
    'DESKTOP',
    'PHONE',
    'SOCIAL_INTEGRATION',
    'SOCIAL_DESKTOP',
    'SOCIAL_PHONE',
  ]) {
    const org = await db.query<{ id: string }>(
      "insert into public.organisation(name,type,country_code,currency,time_zone) values($1,'group','UG','UGX','Africa/Kampala') returning id",
      [`Local meetings ${label.toLowerCase()}`],
    );
    const orgId = org.rows[0]!.id;
    fixtures[`TEST_MEETING_ORG_${label}`] = orgId;
    await db.query(
      "insert into public.membership(person_id,organisation_id,role) values($1,$5,'secretary'),($1,$5,'member'),($2,$5,'treasurer'),($3,$5,'chair'),($4,$5,'member')",
      [meetingSecretary, meetingTreasurer, meetingChair, meetingMember, orgId],
    );
    await db.query(
      'insert into public.group_settings(organisation_id) values($1)',
      [orgId],
    );
    await db.query(
      'insert into public.cycle(organisation_id,starts_on,ends_on,share_price) values($1,current_date-30,current_date+330,5000)',
      [orgId],
    );
    await db.query(
      "insert into public.ledger_account(organisation_id,code) values($1,'cash'),($1,'share_capital')",
      [orgId],
    );
  }
  const values = {
    SUPABASE_URL: status.API_URL,
    SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
    PIN_PEPPER: pepper,
    AUTH_GATEWAY_KEY: gateway,
    SESSION_COOKIE_KEY: key,
    WEB_ORIGIN: 'http://127.0.0.1:5173',
    TEST_DB_URL: status.DB_URL,
    TEST_SERVICE_KEY: status.SERVICE_ROLE_KEY,
    TEST_PIN: pin,
    ...fixtures,
  };
  const names = new Set(Object.keys(values));
  const retained = original
    .split('\n')
    .filter((line) => !names.has(line.split('=')[0] ?? ''))
    .join('\n');
  await writeFile(
    '.env',
    retained.trimEnd() +
      '\n' +
      Object.entries(values)
        .map(([name, value]) => `${name}=${value}`)
        .join('\n') +
      '\n',
    { mode: 0o600 },
  );
  console.log(
    'Provisioned local-only Auth fixtures, group memberships and API configuration. No hosted records were changed.',
  );
} finally {
  await db.end();
}
