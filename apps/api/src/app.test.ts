import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
test('hosted web serving exposes only built assets and preserves API routes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yapesa-web-'));
  const web = join(root, 'dist');
  await mkdir(web);
  await writeFile(join(root, 'secret.txt'), 'outside-root-secret');
  await writeFile(
    join(web, 'index.html'),
    '<!doctype html><title>Yapesa</title>',
  );
  await writeFile(join(web, '.private'), 'dotfile-secret');
  const app = buildApp(undefined, web);
  try {
    const page = await app.inject('/');
    assert.equal(page.statusCode, 200);
    assert.match(String(page.headers['content-type']), /text\/html/);
    assert.match(
      String(page.headers['content-security-policy']),
      /frame-ancestors 'none'/,
    );
    assert.deepEqual((await app.inject('/api/session')).json(), {
      configured: false,
      user: null,
    });
    for (const url of [
      '/.private',
      '/%2e%2e/secret.txt',
      '/.env.hosted',
      '/api/missing',
    ]) {
      const response = await app.inject(url);
      assert(response.statusCode >= 400);
      assert(!response.body.includes('outside-root-secret'));
      assert(!response.body.includes('dotfile-secret'));
    }
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
