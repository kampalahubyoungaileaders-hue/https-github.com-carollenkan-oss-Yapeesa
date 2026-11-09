import test from 'node:test';
import assert from 'node:assert/strict';
import { createMfaResetHandler } from '../mfa-reset/handler.js';
const id = '00000000-0000-4000-8000-000000000111',
  user = '00000000-0000-4000-8000-000000000112',
  factor = '00000000-0000-4000-8000-000000000113',
  other = '00000000-0000-4000-8000-000000000114';
const config = {
  url: 'https://backend.invalid',
  publishableKey: 'public',
  adminKey: 'server-only',
};
const request = (input: object = { id }, auth = true) =>
  new Request('https://app.invalid', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: 'Bearer current-admin' } : {}),
    },
    body: JSON.stringify(input),
  });
const job = { id, auth_user_id: user, factor_ids: [factor], done: false };
test('MFA reset service requires prepared two-administrator authorization before any privileged call', async () => {
  for (const scenario of ['no-token', 'injected-target', 'denied']) {
    const paths: string[] = [];
    const handler = createMfaResetHandler(config, async (input) => {
      paths.push(String(input));
      return Response.json({}, { status: 403 });
    });
    const r = await handler(
      request(
        scenario === 'injected-target' ? { id, user } : undefined,
        scenario !== 'no-token',
      ),
    );
    assert.equal(
      r.status,
      scenario === 'no-token'
        ? 401
        : scenario === 'injected-target'
          ? 400
          : 403,
    );
    assert(!paths.some((p) => p.includes('/auth/')));
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
  }
});
test('MFA reset deletes only the recorded factor IDs and retries safely after an interrupted delete', async () => {
  for (const remaining of [true, false]) {
    const paths: string[] = [];
    const handler = createMfaResetHandler(config, async (input, init) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path.includes('/rest/')) {
        assert.equal(
          new Headers(init?.headers).get('Authorization'),
          'Bearer current-admin',
        );
        return Response.json(job);
      }
      assert.equal(new Headers(init?.headers).get('apikey'), 'server-only');
      if (init?.method === 'DELETE') return Response.json({ id: factor });
      return Response.json(
        remaining
          ? [{ id: factor, factor_type: 'totp', status: 'verified' }]
          : [],
      );
    });
    const r = await handler(request());
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { id });
    assert.equal(paths.length, remaining ? 3 : 2);
    if (remaining)
      assert.equal(paths[2], `/auth/v1/admin/users/${user}/factors/${factor}`);
  }
});
test('MFA reset refuses a new factor and completed jobs never invoke Auth administration', async () => {
  for (const done of [false, true]) {
    let deletes = 0,
      authCalls = 0;
    const handler = createMfaResetHandler(config, async (input, init) => {
      if (String(input).includes('/rest/'))
        return Response.json({ ...job, done });
      authCalls++;
      if (init?.method === 'DELETE') deletes++;
      return Response.json([
        { id: other, factor_type: 'totp', status: 'verified' },
      ]);
    });
    assert.equal((await handler(request())).status, done ? 200 : 409);
    assert.equal(deletes, 0);
    assert.equal(authCalls, done ? 0 : 1);
  }
});
