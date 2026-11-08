import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaffAdminHandler } from '../staff-admin/handler.js';
const invitation = '00000000-0000-4000-8000-000000000123';
const user = '00000000-0000-4000-8000-000000000124';
const config = {
  url: 'https://backend.invalid',
  publishableKey: 'public-key',
  adminKey: 'server-key',
};
const request = (
  input: object = { invitation_id: invitation, phase: 'invite' },
  auth = true,
) =>
  new Request('https://app.invalid', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: 'Bearer actor-token' } : {}),
    },
    body: JSON.stringify(input),
  });
const job = {
  id: invitation,
  phase: 'invite',
  phone: '+256700000023',
  email: 'staff@example.invalid',
  auth_user_id: null,
  done: false,
};
test('staff service rejects unauthenticated, malformed and unprepared jobs without any Auth admin call', async () => {
  for (const scenario of ['no-auth', 'extra-key', 'denied', 'missing-config']) {
    const calls: string[] = [];
    const handler = createStaffAdminHandler(
      scenario === 'missing-config'
        ? { ...config, adminKey: undefined }
        : config,
      async (input) => {
        calls.push(String(input));
        return Response.json({}, { status: 403 });
      },
    );
    const r = await handler(
      request(
        scenario === 'extra-key'
          ? {
              invitation_id: invitation,
              phase: 'invite',
              phone: '+256700000024',
            }
          : undefined,
        scenario !== 'no-auth',
      ),
    );
    assert.equal(
      r.status,
      scenario === 'no-auth'
        ? 401
        : scenario === 'extra-key'
          ? 400
          : scenario === 'missing-config'
            ? 503
            : 403,
    );
    assert(!calls.some((path) => path.includes('/auth/')));
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
  }
});
test('staff account job uses server-approved identity and never auto-confirms or sends a message', async () => {
  const calls: {
    path: string;
    headers: Headers;
    body: Record<string, unknown>;
  }[] = [];
  const handler = createStaffAdminHandler(config, async (input, init) => {
    const path = new URL(String(input)).pathname,
      headers = new Headers(init?.headers),
      body = JSON.parse(String(init?.body));
    calls.push({ path, headers, body });
    return Response.json(path.includes('/rest/') ? job : { id: user });
  });
  const r = await handler(request());
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { id: invitation, auth_user_id: user });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.headers.get('Authorization'), 'Bearer actor-token');
  const created = calls[1]!;
  assert.equal(created.path, '/auth/v1/admin/users');
  assert.equal(created.headers.get('apikey'), 'server-key');
  assert.equal(created.body['phone_confirm'], false);
  assert.equal(created.body['email_confirm'], false);
  assert.equal(created.body['email'], job.email);
  assert.match(String(created.body['password']), /^[a-f0-9]{96}$/);
  assert.deepEqual(created.body['app_metadata'], {
    yapesa_activation: 'pending',
    yapesa_invitation_id: invitation,
  });
});
test('interrupted account creation retries reuse a bound account, and completed jobs never call admin APIs', async () => {
  for (const done of [false, true]) {
    let count = 0;
    const handler = createStaffAdminHandler(config, async () => {
      count++;
      return Response.json({ ...job, auth_user_id: user, done });
    });
    assert.equal((await handler(request())).status, 200);
    assert.equal(count, 1);
  }
});
test('activation refuses a mismatched server identity and preserves unrelated app metadata', async () => {
  for (const valid of [false, true]) {
    let updates = 0;
    const handler = createStaffAdminHandler(config, async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.includes('/rest/'))
        return Response.json({ ...job, phase: 'activate', auth_user_id: user });
      if (init?.method === 'GET')
        return Response.json({
          id: user,
          phone: job.phone.slice(1),
          phone_confirmed_at: '2026-11-08T00:00:00Z',
          app_metadata: {
            other: 'preserved',
            yapesa_invitation_id: valid ? invitation : user,
          },
        });
      updates++;
      assert.deepEqual(JSON.parse(String(init?.body)).app_metadata, {
        other: 'preserved',
        yapesa_invitation_id: invitation,
        yapesa_activation: 'active',
      });
      return Response.json({ id: user });
    });
    assert.equal(
      (await handler(request({ invitation_id: invitation, phase: 'activate' })))
        .status,
      valid ? 200 : 503,
    );
    assert.equal(updates, valid ? 1 : 0);
  }
});
