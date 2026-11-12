import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import { Fineract } from '../apps/api/src/fineract.ts';
import { encryptTenantPassword } from '../apps/api/src/fineract-tenant-format.ts';
import {
  lenderProduct,
  lenderTemplate,
} from '../apps/api/src/lender-template.ts';
import { localStaffPassword } from './fineract-test-credentials.mjs';

// Phase 5 operator spike. Only fresh randomly named tenants in the exact local
// Compose database are supported. No hosted endpoint or customer export input.
assert.equal(process.env.FINERACT_LOCAL_TENANT_PROOF, '1');
assert(
  process.env.FINERACT_DB_PASSWORD && process.env.FINERACT_MASTER_PASSWORD,
);
const compose = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infra/fineract/docker-compose.yml',
];
const endpoint = {
  url: 'https://127.0.0.1:8443/fineract-provider/api/v1/',
  localTest: true,
};
const bootstrap = {
  username: process.env.FINERACT_LOCAL_ADMIN_USER ?? 'mifos',
  password: process.env.FINERACT_LOCAL_ADMIN_PASSWORD ?? 'password',
};
const suffix = randomBytes(8).toString('hex');
const plans = ['a', 'b'].map((letter) => ({
  identifier: `yp_probe_${letter}_${suffix}`,
  database: `yp_probe_${letter}_${suffix}`,
  role: `yp_probe_${letter}_${suffix}`,
  password: randomBytes(32).toString('base64url'),
  name: `Disposable lender ${letter}`,
  timezone: 'Africa/Kampala',
  roleCreated: false,
  databaseCreated: false,
  registered: false,
}));
let stage = 'scope',
  admin,
  sourceConfig,
  engineStopped = false;
const clients = new Set();
function command(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0;
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on('error', () =>
      reject(new Error(`Local Docker unavailable at ${stage}`)),
    );
    child.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`Local Docker operation failed at ${stage}`)),
    );
  });
}
const ident = (name) => {
  assert(/^yp_probe_[ab]_[a-f0-9]{16}$/.test(name));
  return `"${name}"`;
};
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
async function connect(config) {
  const client = new pg.Client({ ...config, connectionTimeoutMillis: 5000 });
  await client.connect();
  clients.add(client);
  return client;
}
async function native(client, method, path, body) {
  try {
    return await client.request(method, path, body);
  } catch (error) {
    console.error(
      `Native tenant failure at ${stage}: ${error.code ?? 'FAILED'} fields=${error.fields?.join(',') ?? ''}`,
    );
    throw new Error(
      `Native tenant contract failed at ${stage}: ${error.code ?? 'FAILED'} fields=${error.fields?.join(',') ?? ''}`,
      { cause: error },
    );
  }
}
const resource = (value) => {
  assert.match(value.resourceId, /^[1-9]\d*$/);
  return value.resourceId;
};
async function stop() {
  engineStopped = true;
  await command([...compose, 'stop', 'fineract']);
}
async function start() {
  await command([...compose, 'start', 'fineract']);
  engineStopped = false;
}
async function ready() {
  const client = new Fineract(endpoint, 'default', bootstrap),
    deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    try {
      await client.request('GET', 'offices');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw new Error(`Native tenant migrations did not become ready at ${stage}`);
}
const terms = {
  currencyCode: 'UGX',
  digitsAfterDecimal: '0',
  inMultiplesOf: '0',
  principal: '100000',
  numberOfRepayments: '1',
  repaymentEvery: '1',
  repaymentFrequencyType: '2',
  interestRatePerPeriod: '1',
  interestRateFrequencyType: '2',
  amortizationType: '1',
  interestCalculationPeriodType: '1',
  transactionProcessingStrategyCode: 'mifos-standard-strategy',
  daysInMonthType: '1',
  daysInYearType: '1',
  accountingRule: '2',
  isInterestRecalculationEnabled: false,
  charges: [],
}; // Explicit disposable terms, never customer product defaults.
async function applyTemplate(client) {
  const journals = await native(
    client,
    'GET',
    'journalentries?limit=1&offset=0',
  );
  assert.equal(journals.totalFilteredRecords, '0');
  assert.equal((await native(client, 'GET', 'loanproducts')).length, 0);
  const currencies = await native(client, 'GET', 'currencies');
  const selected = currencies.selectedCurrencyOptions.map((row) => row.code);
  if (!selected.includes(terms.currencyCode))
    await native(client, 'PUT', 'currencies', {
      currencies: [...selected, terms.currencyCode],
    });
  const accounts = {},
    products = {},
    roles = {};
  for (const account of lenderTemplate.accounts)
    accounts[account.key] = resource(
      await native(client, 'POST', 'glaccounts', {
        name: account.name,
        glCode: account.code,
        type: account.type,
        usage: '1',
        manualEntriesAllowed: true,
      }),
    );
  for (const product of lenderTemplate.products) {
    const id = resource(
      await native(
        client,
        'POST',
        'loanproducts',
        lenderProduct(product.key, terms, accounts),
      ),
    );
    const saved = await native(client, 'GET', `loanproducts/${id}`);
    assert.equal(saved.interestType.id, product.interestType);
    assert.equal(saved.currency.code, terms.currencyCode);
    assert.equal(saved.currency.decimalPlaces, terms.digitsAfterDecimal);
    assert.match(saved.interestRatePerPeriod, /^1(?:\.0+)?$/);
    products[product.key] = id;
  }
  for (const role of lenderTemplate.roles) {
    const id = resource(
      await native(client, 'POST', 'roles', {
        name: `Yapesa ${role.key}`,
        description: lenderTemplate.version,
      }),
    );
    const catalogue = await native(client, 'GET', `roles/${id}/permissions`);
    const available = new Set(catalogue.permissionUsageData.map((p) => p.code));
    for (const code of role.permissions)
      assert(
        available.has(code),
        `Pinned template permission missing: ${code}`,
      );
    await native(client, 'PUT', `roles/${id}/permissions`, {
      permissions: Object.fromEntries(role.permissions.map((p) => [p, true])),
    });
    const configured = await native(client, 'GET', `roles/${id}/permissions`);
    assert.deepEqual(
      configured.permissionUsageData
        .filter((p) => p.selected)
        .map((p) => p.code)
        .sort(),
      [...role.permissions].sort(),
    );
    roles[role.key] = id;
  }
  const config = await native(client, 'GET', 'configurations');
  const makerChecker = config.globalConfiguration.find(
    (row) => row.name === 'maker-checker',
  );
  assert(makerChecker);
  await native(client, 'PUT', 'permissions', {
    permissions: Object.fromEntries(
      lenderTemplate.nativeCheckedActions.map((p) => [p, true]),
    ),
  });
  return { accounts, products, roles, makerCheckerId: makerChecker.id };
}
try {
  const id = (await command([...compose, 'ps', '-q', 'db'])).toString().trim();
  assert(/^[a-f0-9]{12,64}$/.test(id));
  const info = JSON.parse((await command(['inspect', id])).toString())[0];
  assert.equal(
    info.Config.Labels['com.docker.compose.project'],
    'yapesa-fineract',
  );
  assert.equal(info.Config.Labels['com.docker.compose.service'], 'db');
  const networks = Object.values(info.NetworkSettings.Networks);
  assert.equal(networks.length, 1);
  assert(/^\d+\.\d+\.\d+\.\d+$/.test(networks[0].IPAddress));
  sourceConfig = {
    host: networks[0].IPAddress,
    port: 5432,
    user: 'fineract',
    password: process.env.FINERACT_DB_PASSWORD,
  };
  admin = await connect({ ...sourceConfig, database: 'fineract_tenants' });
  // Suppress statement/parameter logging for this private operator session.
  await admin.query(
    "set log_statement='none'; set log_min_error_statement='panic'; set log_parameter_max_length_on_error=0",
  );
  const master = (
    await admin.query(
      "select c.master_password_hash from tenants t join tenant_server_connections c on c.id=t.oltp_id where t.identifier='default'",
    )
  ).rows;
  assert.equal(master.length, 1);
  assert(/^\$2[aby]\$/.test(master[0].master_password_hash));
  stage = 'pause engine for tenant registration';
  await stop();
  for (const plan of plans) {
    stage = 'create isolated tenant database';
    const collision = await admin.query(
      'select 1 from pg_database where datname=$1 union all select 1 from pg_roles where rolname=$1',
      [plan.database],
    );
    assert.equal(collision.rowCount, 0, 'Refuse existing operator resource');
    await admin.query(
      `create role ${ident(plan.role)} login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password ${literal(plan.password)}`,
    );
    plan.roleCreated = true;
    await admin.query(
      `create database ${ident(plan.database)} owner ${ident(plan.role)} template template0`,
    );
    plan.databaseCreated = true;
    await admin.query(
      `revoke all on database ${ident(plan.database)} from public`,
    );
    const encrypted = encryptTenantPassword(
      process.env.FINERACT_MASTER_PASSWORD,
      plan.password,
    );
    await admin.query('begin');
    try {
      await admin.query(
        "select pg_advisory_xact_lock(hashtextextended('yapesa-local-tenant-provision',0))",
      );
      const connection = (
        await admin.query(
          'select (coalesce(max(id),0)+1)::text id from tenant_server_connections',
        )
      ).rows[0].id;
      const tenant = (
        await admin.query(
          'select (coalesce(max(id),0)+1)::text id from tenants',
        )
      ).rows[0].id;
      await admin.query(
        `insert into tenant_server_connections(id,schema_server,schema_name,schema_server_port,schema_username,schema_password,master_password_hash,
        pool_initial_size,pool_max_active,pool_min_idle,pool_max_idle,readonly_schema_server,readonly_schema_name,readonly_schema_server_port,readonly_schema_username,readonly_schema_password)
        values($1,'db',$2,'5432',$3,$4,$5,1,4,1,2,'db',$2,'5432',$3,$4)`,
        [
          connection,
          plan.database,
          plan.role,
          encrypted,
          master[0].master_password_hash,
        ],
      );
      await admin.query(
        'insert into tenants(id,identifier,name,timezone_id,oltp_id,report_id) values($1,$2,$3,$4,$5,$5)',
        [tenant, plan.identifier, plan.name, plan.timezone, connection],
      );
      await admin.query('commit');
      plan.registered = true;
    } catch {
      await admin.query('rollback');
      throw new Error(`Native registry registration failed at ${stage}`);
    }
  }
  stage = 'run native tenant migrations';
  await start();
  await ready();
  for (const [index, plan] of plans.entries()) {
    stage = 'apply explicit lender template';
    let operator = new Fineract(endpoint, plan.identifier, bootstrap);
    const auth = await native(operator, 'POST', 'authentication', {
      ...bootstrap,
    });
    assert(auth.userId);
    const operatorPassword = localStaffPassword();
    await native(operator, 'PUT', `users/${auth.userId}`, {
      password: operatorPassword,
      repeatPassword: operatorPassword,
    });
    operator = new Fineract(endpoint, plan.identifier, {
      username: bootstrap.username,
      password: operatorPassword,
    });
    const offices = await native(operator, 'GET', 'offices'),
      office = offices[0].id;
    const clientId = resource(
      await native(operator, 'POST', 'clients', {
        officeId: office,
        firstname: 'Local',
        lastname: index === 0 ? 'TenantAlpha' : 'TenantBeta',
        legalFormId: '1',
        submittedOnDate: '2026-11-01',
        dateFormat: 'yyyy-MM-dd',
        locale: 'en',
        active: false,
      }),
    );
    const applied = await applyTemplate(operator);
    const credentials = {
      username: `probe_staff_${suffix}`,
      password: localStaffPassword(),
    };
    await native(operator, 'POST', 'users', {
      username: credentials.username,
      firstname: 'Local',
      lastname: 'TenantStaff',
      email: `probe${index}@example.invalid`,
      officeId: office,
      roles: [applied.roles.loan_officer],
      password: credentials.password,
      repeatPassword: credentials.password,
      sendPasswordToEmail: false,
      isSelfServiceUser: false,
      passwordNeverExpires: true,
    });
    await native(operator, 'PUT', `configurations/${applied.makerCheckerId}`, {
      enabled: true,
    });
    const enabledConfig = await native(operator, 'GET', 'configurations');
    assert.equal(
      enabledConfig.globalConfiguration.find(
        (row) => row.name === 'maker-checker',
      )?.enabled,
      true,
    );
    const checked = await native(
      operator,
      'GET',
      'permissions?makerCheckerable=true',
    );
    for (const code of lenderTemplate.nativeCheckedActions)
      assert.equal(checked.find((p) => p.code === code)?.selected, true);
    plan.credentials = credentials;
    plan.clientId = clientId;
    const own = await native(
      new Fineract(endpoint, plan.identifier, credentials),
      'GET',
      `clients/${clientId}`,
    );
    assert.equal(own.lastname, index === 0 ? 'TenantAlpha' : 'TenantBeta');
    plan.client = await connect({
      ...sourceConfig,
      database: plan.database,
      user: plan.role,
      password: plan.password,
    });
    const rights = (
      await admin.query(
        'select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=$1',
        [plan.role],
      )
    ).rows[0];
    assert(Object.values(rights).every((value) => value === false));
    assert.equal(
      (await plan.client.query('select current_database() name')).rows[0].name,
      plan.database,
    );
  }
  stage = 'prove native and database tenant isolation';
  assert.equal(
    plans[0].clientId,
    plans[1].clientId,
    'Use overlapping native IDs to test tenant separation',
  );
  for (const [own, foreign] of [
    [plans[0], plans[1]],
    [plans[1], plans[0]],
  ]) {
    await assert.rejects(
      () =>
        new Fineract(endpoint, foreign.identifier, own.credentials).request(
          'GET',
          'clients',
        ),
      { code: 'FINERACT_CREDENTIALS_REJECTED' },
    );
    const wrong = new pg.Client({
      ...sourceConfig,
      database: foreign.database,
      user: own.role,
      password: own.password,
    });
    try {
      await assert.rejects(() => wrong.connect(), { code: '42501' });
    } finally {
      await wrong.end().catch(() => {});
    }
    const registry = await connect({
      ...sourceConfig,
      database: 'fineract_tenants',
      user: own.role,
      password: own.password,
    });
    try {
      await assert.rejects(
        () => registry.query('select 1 from tenant_server_connections limit 1'),
        { code: '42501' },
      );
    } finally {
      await registry.end();
      clients.delete(registry);
    }
    const journals = (
      await own.client.query(
        'select count(*)::text count from acc_gl_journal_entry',
      )
    ).rows[0].count;
    assert.equal(
      journals,
      '0',
      'This spike creates configuration, not financial entries',
    );
  }
  console.log(
    JSON.stringify({
      proof: 'local-named-tenants-and-lender-template',
      fineractVersion: '1.12.0',
      tenants: 2,
      separateDatabasesAndRestrictedRoles: true,
      nativeMigrationsApplied: true,
      nativeCrossTenantLoginRejected: true,
      crossDatabaseConnectRejected: true,
      overlappingClientIdsIsolated: true,
      cashChartAndTwoLoanProductsVerified: true,
      exactRestrictedNativeRolesVerified: true,
      nativeMakerCheckerConfigured: true,
      template: lenderTemplate.version,
      templateHash: createHash('sha256')
        .update(JSON.stringify(lenderTemplate))
        .digest('hex'),
      financialEntriesCreated: 0,
      messagesSent: 0,
      paidResourcesCreated: 0,
      limitation:
        'Local privileged operator spike; hosted worker, durable provisioning/reconciliation, Yapesa organisation binding and self-serve onboarding remain required. Fixture loan terms are not customer defaults.',
    }),
  );
} catch (error) {
  // Never relay SQL, ciphertext, passwords or upstream response bodies.
  console.error(
    `Tenant acceptance failed at ${stage}; ${error.code ?? error.name ?? 'FAILED'}`,
  );
  console.error(
    (error.stack ?? '')
      .split('\n')
      .filter((line) => line.trim().startsWith('at '))
      .slice(0, 4)
      .join('\n'),
  );
  process.exitCode = 1;
} finally {
  for (const client of clients)
    if (client !== admin) await client.end().catch(() => {});
  try {
    if (admin && plans.some((plan) => plan.roleCreated || plan.registered)) {
      stage = 'remove only this proof configuration';
      await stop();
      for (const plan of plans) {
        if (plan.databaseCreated) {
          const check = await connect({
            ...sourceConfig,
            database: plan.database,
          });
          try {
            const exists = (
              await check.query(
                "select to_regclass('public.acc_gl_journal_entry') present",
              )
            ).rows[0].present;
            if (exists)
              assert.equal(
                (
                  await check.query(
                    'select count(*)::text count from acc_gl_journal_entry',
                  )
                ).rows[0].count,
                '0',
                'Preserve unexpected financial records',
              );
          } finally {
            await check.end();
            clients.delete(check);
          }
        }
        if (plan.registered) {
          await admin.query('begin');
          const removed = await admin.query(
            'delete from tenants where identifier=$1 returning oltp_id,report_id',
            [plan.identifier],
          );
          assert.equal(removed.rowCount, 1);
          await admin.query(
            'delete from tenant_server_connections where id=$1 and schema_name=$2 and schema_username=$3',
            [removed.rows[0].oltp_id, plan.database, plan.role],
          );
          await admin.query('commit');
        }
        if (plan.databaseCreated)
          await admin.query(`drop database ${ident(plan.database)}`);
        if (plan.roleCreated)
          await admin.query(`drop role ${ident(plan.role)}`);
      }
    }
  } finally {
    if (admin) await admin.end().catch(() => {});
    if (engineStopped) {
      await start();
      await ready();
    }
  }
}
