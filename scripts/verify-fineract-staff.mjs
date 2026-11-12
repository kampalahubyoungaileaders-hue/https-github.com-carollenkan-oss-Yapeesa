import assert from 'node:assert/strict';
import https from 'node:https';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { localStaffPassword } from './fineract-test-credentials.mjs';

// Only the disposable, loopback-bound Compose service is supported. No hosted
// Fineract credentials, Supabase records, financial accounts or messages are used.
assert.equal(
  process.env.FINERACT_LOCAL_IDENTITY_PROOF,
  '1',
  'Explicit disposable Fineract proof required',
);
const base = new URL(
  process.env.FINERACT_LOCAL_TEST_URL ??
    'https://127.0.0.1:8443/fineract-provider/api/v1/',
);
assert(['localhost', '127.0.0.1'].includes(base.hostname));
assert.equal(base.protocol, 'https:');
assert.equal(base.port, '8443');
assert.equal(base.pathname, '/fineract-provider/api/v1/');
assert(!base.username && !base.password && !base.search && !base.hash);
const prefix = `yp_probe_${randomBytes(6).toString('hex')}`;
// The pinned upstream integration tests document this local bootstrap account.
// FINERACT_DEFAULT_TENANTDB_MASTER_PASSWORD encrypts tenant configuration; it is
// not the bootstrap user's login password.
const admin = {
  username: process.env.FINERACT_LOCAL_ADMIN_USER ?? 'mifos',
  password: process.env.FINERACT_LOCAL_ADMIN_PASSWORD ?? 'password',
};
const roles = [],
  users = [],
  clients = [];
function call(actor, method, path, body, tenant = 'default') {
  assert(/^[a-z0-9_-]+$/.test(tenant));
  const url = new URL(path, base);
  assert.equal(url.origin, base.origin);
  assert(url.pathname.startsWith(base.pathname));
  const data =
    body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        rejectUnauthorized: false,
        timeout: 15000,
        headers: {
          Accept: 'application/json',
          'Fineract-Platform-TenantId': tenant,
          Authorization: `Basic ${Buffer.from(`${actor.username}:${actor.password}`).toString('base64')}`,
          ...(data
            ? {
                'Content-Type': 'application/json',
                'Content-Length': data.length,
              }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (b) => {
          size += b.length;
          if (size > 2 * 1024 * 1024)
            req.destroy(new Error('Local Fineract response limit'));
          else chunks.push(b);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let result;
          try {
            result = text ? JSON.parse(text) : null;
          } catch {
            reject(
              new Error(`Local Fineract returned non-JSON (${res.statusCode})`),
            );
            return;
          }
          resolve({ status: res.statusCode, data: result });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () =>
      req.destroy(new Error('Local Fineract request timed out')),
    );
    req.on('error', reject);
    req.end(data);
  });
}
async function ok(actor, method, path, body) {
  const response = await call(actor, method, path, body);
  // Never put response bodies, passwords or authentication keys in failure logs.
  if (![200, 201, 202].includes(response.status)) {
    const parameters = Array.isArray(response.data?.errors)
      ? response.data.errors
          .map((e) => e.parameterName)
          .filter((v) => typeof v === 'string' && /^[A-Za-z0-9_]+$/.test(v))
      : [];
    throw new Error(
      `Local Fineract ${method} ${path.split('?')[0]} status ${response.status}; validation fields: ${parameters.join(',')}`,
    );
  }
  return response.data;
}
function id(result) {
  assert(
    Number.isSafeInteger(result.resourceId) && result.resourceId > 0,
    'Expected a new disposable resource ID',
  );
  return result.resourceId;
}
function actor(suffix) {
  return {
    username: `${prefix}_${suffix}`,
    password: localStaffPassword(),
  };
}
async function role(suffix, permissions) {
  const roleId = id(
    await ok(admin, 'POST', 'roles', {
      name: `${prefix}_${suffix}`,
      description: 'Disposable Yapesa least-privilege identity proof',
    }),
  );
  roles.push(roleId);
  await ok(admin, 'PUT', `roles/${roleId}/permissions`, {
    permissions: Object.fromEntries(permissions.map((p) => [p, true])),
  });
  const configured = await ok(admin, 'GET', `roles/${roleId}/permissions`);
  const selected = configured.permissionUsageData
    .filter((p) => p.selected)
    .map((p) => p.code)
    .sort();
  assert.deepEqual(
    selected,
    [...permissions].sort(),
    'No implicit ALL_FUNCTIONS or money permissions',
  );
  return roleId;
}
async function user(value, roleId, officeId) {
  const userId = id(
    await ok(admin, 'POST', 'users', {
      username: value.username,
      firstname: 'Local',
      lastname: 'IdentityProbe',
      email: `${value.username}@example.invalid`,
      officeId,
      roles: [roleId],
      sendPasswordToEmail: false,
      password: value.password,
      repeatPassword: value.password,
      passwordNeverExpires: true,
      isSelfServiceUser: false,
    }),
  );
  users.push(userId);
  const authentication = await ok(value, 'POST', 'authentication', {
    username: value.username,
    password: value.password,
  });
  assert.equal(authentication.authenticated, true);
  assert.equal(authentication.username, value.username);
  assert.equal(authentication.userId, userId);
  return userId;
}
let proof;
try {
  const authentication = await ok(admin, 'POST', 'authentication', {
    username: admin.username,
    password: admin.password,
  });
  assert.equal(authentication.authenticated, true);
  const template = await ok(admin, 'GET', 'users/template');
  const officeId = template.allowedOffices?.[0]?.id;
  assert(Number.isSafeInteger(officeId) && officeId > 0);
  const writerRole = await role('writer', [
    'READ_CLIENT',
    'CREATE_CLIENT',
    'READ_AUDIT',
  ]);
  const readerRole = await role('reader', ['READ_CLIENT']);
  const writer = actor('writer'),
    reader = actor('reader');
  const writerId = await user(writer, writerRole, officeId),
    readerId = await user(reader, readerRole, officeId);
  assert.notEqual(writerId, readerId);
  assert.notEqual(writerId, authentication.userId);
  assert.notEqual(readerId, authentication.userId);
  const date = new Date().toISOString().slice(0, 10);
  const client = {
    officeId,
    firstname: 'Local',
    lastname: 'IdentityProbe',
    externalId: `${prefix}_client`,
    active: false,
    legalFormId: 1,
    submittedOnDate: date,
    dateFormat: 'yyyy-MM-dd',
    locale: 'en',
  };
  const created = await ok(writer, 'POST', 'clients', client);
  const clientId = id(created);
  clients.push(clientId);
  const saved = await ok(reader, 'GET', `clients/${clientId}`);
  assert.equal(saved.id, clientId);
  assert.equal(saved.externalId, client.externalId);
  const denied = await call(reader, 'POST', 'clients', {
    ...client,
    externalId: `${prefix}_denied`,
  });
  assert.equal(denied.status, 403, 'Read-only staff cannot create clients');
  assert.equal(
    (await call(reader, 'GET', 'users')).status,
    403,
    'Read-only staff cannot administer users',
  );
  const audits = await ok(
    writer,
    'GET',
    `audits?entityName=CLIENT&resourceId=${clientId}&actionName=CREATE&paged=true&limit=20`,
  );
  const rows = Array.isArray(audits) ? audits : audits.pageItems;
  assert(Array.isArray(rows));
  const audit = rows.find(
    (a) => a.resourceId === clientId && a.actionName === 'CREATE',
  );
  assert(audit, 'Client creation must have a permanent audit record');
  assert.equal(
    audit.maker,
    writer.username,
    'Audit must attribute the individual staff account, never the provisioning administrator',
  );
  await ok(admin, 'PUT', `users/${writerId}`, { roles: [readerRole] });
  assert.equal(
    (
      await call(writer, 'POST', 'clients', {
        ...client,
        externalId: `${prefix}_revoked`,
      })
    ).status,
    403,
    'A role change must remove write permission from the same staff credentials',
  );
  const unknownTenant = await call(
    reader,
    'GET',
    `clients/${clientId}`,
    undefined,
    `${prefix}_missing`,
  );
  assert(
    [400, 401, 403, 404].includes(unknownTenant.status),
    'An unknown tenant must be rejected without falling back to default',
  );
  proof = {
    proof: 'local-fineract-per-staff-identity',
    fineractVersion: '1.12.0',
    distinctStaffAccounts: true,
    leastPrivilegeVerified: true,
    auditAttributedToActualStaff: true,
    roleRevocationVerified: true,
    unknownTenantRejected: true,
    financialAccountsCreated: 0,
    messagesSent: 0,
    limitation:
      'Disposable default tenant only; hosted tenant provisioning, maker-checker policies and SACCO/lender financial workflows remain unverified.',
  };
} finally {
  let failed = false;
  for (const resource of [
    ...clients.map((value) => `clients/${value}`),
    ...users.map((value) => `users/${value}`),
    ...roles.map((value) => `roles/${value}`),
  ]) {
    try {
      const response = await call(admin, 'DELETE', resource);
      if (![200, 204, 404].includes(response.status)) failed = true;
    } catch {
      failed = true;
    }
  }
  assert(
    !failed,
    'Disposable identity fixture cleanup failed; inspect the isolated local stack before reusing it',
  );
}
console.log(JSON.stringify(proof));
