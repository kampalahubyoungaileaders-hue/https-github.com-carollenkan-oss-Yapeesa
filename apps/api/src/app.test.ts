import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.js';
test('health endpoint works without exposing infrastructure or secrets', async () => {
  const app = buildApp();
  try {
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
    assert.equal(
      (await app.inject({ method: 'POST', url: '/health' })).statusCode,
      404,
    );
  } finally {
    await app.close();
  }
});
