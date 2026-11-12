import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptTenantPassword,
  decryptTenantPassword,
} from './fineract-tenant-format.js';
test('native registry encryption decodes the pinned upstream Java test vector', () => {
  assert.equal(
    decryptTenantPassword(
      'fineract',
      'Oy/ah382msZT9ZAYBmQgsIXJYOdkB5MoF+3XMkQVkcZTduNSam3+0VpGYOGyXojs',
    ),
    'postgres',
  );
});
test('native registry password envelopes use fresh IVs and salts and reject malformed encodings', () => {
  const a = encryptTenantPassword(
    'local-test-master',
    'local-test-database-password',
  );
  const b = encryptTenantPassword(
    'local-test-master',
    'local-test-database-password',
  );
  assert.notEqual(a, b);
  assert.equal(
    decryptTenantPassword('local-test-master', a),
    'local-test-database-password',
  );
  for (const encoded of ['', '!!!!', 'AA==', a.slice(1)])
    assert.throws(() => decryptTenantPassword('local-test-master', encoded));
});
