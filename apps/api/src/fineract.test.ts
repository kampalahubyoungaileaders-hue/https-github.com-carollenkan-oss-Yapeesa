import test from 'node:test';
import assert from 'node:assert/strict';
import { fineractJson, fineractMinor, Fineract } from './fineract.js';
import { saccoOperations, saccoPayload } from './sacco-catalog.js';
test('individual SACCO members include the native legal form and await activation', () => {
  const operation = saccoOperations.find(
    (item) => item.id === 'member.create',
  )!;
  const payload = saccoPayload(operation, {
    officeId: '1',
    firstname: 'Local',
    lastname: 'Member',
    submittedOnDate: '2026-11-01',
  });
  assert.equal(payload['legalFormId'], '1');
  assert.equal(payload['active'], false);
});
test('Fineract numbers retain their exact source tokens, including beyond safe integers', () => {
  assert.deepEqual(
    fineractJson(
      '{"id":9223372036854775807,"amount":9007199254740993.01,"rate":1e-9,"negative":-0.00,"text":"42","enabled":true}',
    ),
    {
      id: '9223372036854775807',
      amount: '9007199254740993.01',
      rate: '1e-9',
      negative: '-0.00',
      text: '42',
      enabled: true,
    },
  );
  assert.equal(fineractMinor('9007199254740993.01', 2), '900719925474099301');
  assert.equal(fineractMinor('1.2000e2', 2), '12000');
  assert.equal(fineractMinor('-0.00', 2), '0');
  assert.throws(() => fineractMinor('1.001', 2));
  assert.throws(() => fineractJson('{"amount":NaN}'));
});
test('Fineract configuration fails closed for default tenants, URL credentials and nonlocal TLS bypass', () => {
  const actor = { username: 'individual-staff', password: 'test-only' };
  for (const endpoint of [
    { url: 'http://example.invalid/fineract-provider/api/v1/' },
    {
      url: 'https://example.invalid/fineract-provider/api/v1/',
      localTest: true,
    },
    { url: 'https://user:secret@example.invalid/fineract-provider/api/v1/' },
    { url: 'https://example.invalid/wrong/' },
  ])
    assert.throws(() => new Fineract(endpoint, 'sacco_a', actor));
  assert.throws(
    () =>
      new Fineract(
        { url: 'https://example.invalid/fineract-provider/api/v1/' },
        'default',
        actor,
      ),
  );
  assert.doesNotThrow(
    () =>
      new Fineract(
        {
          url: 'https://127.0.0.1:8443/fineract-provider/api/v1/',
          localTest: true,
        },
        'default',
        actor,
      ),
  );
});
test('Fineract rejects path traversal before connecting', async () => {
  const client = new Fineract(
    { url: 'https://example.invalid/fineract-provider/api/v1/' },
    'sacco_a',
    { username: 'staff', password: 'test-only' },
  );
  for (const path of [
    'https://other.invalid/',
    '../users',
    'clients/%2e%2e/users',
    'clients/%2fusers',
  ])
    await assert.rejects(() => client.request('GET', path));
});
import { sealFineract, openFineract } from './sacco-credentials.js';
import { randomBytes } from 'node:crypto';
test('Fineract credential envelopes cannot move between people, SACCOs, users or connection revisions', () => {
  const key = randomBytes(32),
    actor = { username: 'personal-staff', password: 'private-test-only' };
  const sealed = sealFineract(
    actor,
    key,
    'person-a',
    'org-a',
    'version-a',
    '42',
  );
  assert(!sealed.includes(actor.password));
  assert.deepEqual(
    openFineract(sealed, key, 'person-a', 'org-a', 'version-a', '42'),
    actor,
  );
  for (const args of [
    ['person-b', 'org-a', 'version-a', '42'],
    ['person-a', 'org-b', 'version-a', '42'],
    ['person-a', 'org-a', 'version-b', '42'],
    ['person-a', 'org-a', 'version-a', '43'],
  ])
    assert.throws(() =>
      openFineract(sealed, key, ...(args as [string, string, string, string])),
    );
  assert.throws(() =>
    openFineract(
      sealed,
      randomBytes(32),
      'person-a',
      'org-a',
      'version-a',
      '42',
    ),
  );
});

test('cash withdrawal uses the native transaction permission, not application withdrawal', () => {
  assert.equal(
    saccoOperations.find((item) => item.id === 'savings.withdraw')?.permission,
    'WITHDRAWAL_SAVINGSACCOUNT',
  );
});

test('native dividend approval uses PUT with a dividend subresource', () => {
  const operation = saccoOperations.find(
    (item) => item.id === 'dividend.approve',
  )!;
  assert.equal(operation.method, 'PUT');
  assert.equal(operation.subTarget, true);
});
