import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { deriveAuthPassword, sealTokens, openTokens } from './security.js';
test('PIN-derived provider credentials need the server pepper and bind the phone', () => {
  const pepper = randomBytes(32).toString('hex');
  const password = deriveAuthPassword('+256700000011', '123456', pepper);
  assert.notEqual(password, '123456');
  assert.notEqual(
    password,
    deriveAuthPassword('+256700000012', '123456', pepper),
  );
  assert.notEqual(
    password,
    deriveAuthPassword('+256700000011', '123457', pepper),
  );
  assert.throws(() => deriveAuthPassword('0700000011', '123456', pepper));
  assert.throws(() => deriveAuthPassword('+256700000011', '12345', pepper));
  assert.throws(() => deriveAuthPassword('+256700000011', '123456', 'short'));
});
test('authenticated encrypted cookies reject tampering and unrelated keys', () => {
  const key = randomBytes(32);
  const tokens = {
    access_token: 'opaque-access',
    refresh_token: 'opaque-refresh',
  };
  const cookie = sealTokens(tokens, key);
  assert.deepEqual(openTokens(cookie, key), tokens);
  assert(!cookie.includes('opaque-access'));
  const bytes = Buffer.from(cookie, 'base64url');
  bytes[30] = (bytes[30] ?? 0) ^ 1;
  assert.throws(() => openTokens(bytes.toString('base64url'), key));
  assert.throws(() => openTokens(cookie, randomBytes(32)));
  assert.throws(() => openTokens('bad!', key));
});
