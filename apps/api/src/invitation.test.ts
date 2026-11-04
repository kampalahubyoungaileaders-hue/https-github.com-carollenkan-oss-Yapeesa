import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { buildApp } from './app.js';
import type { ApiConfig } from './config.js';
import { deriveAuthPassword } from './security.js';

const config: ApiConfig = {
  supabaseUrl: 'https://example.supabase.co',
  publishableKey: 'test-publishable',
  pinPepper: 'test-pepper-'.repeat(4),
  gatewayKey: 'test-gateway-'.repeat(4),
  cookieKey: randomBytes(32),
  webOrigin: 'https://yapesa.example',
  secureCookies: true,
};
const phone = '+256700000011';
const payload = { phone, code: '123456', pin: '638291' };
const pending = {
  phone: phone.slice(1),
  phone_confirmed_at: '2026-11-04T00:00:00Z',
  app_metadata: { yapesa_activation: 'pending' },
  factors: [],
};
const context = {
  person_id: '00000000-0000-4000-8000-000000000011',
  display_name: 'Test invite',
  requires_mfa: false,
  mfa_verified: false,
};

test('invitation setup gates password changes and cookies on a valid pending invitation', async (t) => {
  for (const scenario of [
    'success',
    'invalid-code',
    'not-pending',
    'unconfirmed',
    'wrong-phone',
    'verified-factor',
    'no-person',
    'password-failure',
  ]) {
    await t.test(scenario, async () => {
      const original = globalThis.fetch;
      const calls: {
        path: string;
        method: string;
        body: Record<string, unknown>;
      }[] = [];
      globalThis.fetch = async (input, init) => {
        const path = new URL(String(input)).pathname;
        const method = init?.method ?? 'GET';
        const body = init?.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : {};
        calls.push({ path, method, body });
        if (path.endsWith('/verify'))
          return Response.json(
            scenario === 'invalid-code'
              ? { code: 'otp_expired' }
              : { access_token: 'access', refresh_token: 'refresh' },
            { status: scenario === 'invalid-code' ? 403 : 200 },
          );
        if (path.endsWith('/user') && method === 'PUT')
          return Response.json(
            {},
            { status: scenario === 'password-failure' ? 500 : 200 },
          );
        if (path.endsWith('/user'))
          return Response.json({
            ...pending,
            ...(scenario === 'not-pending'
              ? {
                  app_metadata: {},
                  user_metadata: { yapesa_activation: 'pending' },
                }
              : {}),
            ...(scenario === 'unconfirmed' ? { phone_confirmed_at: null } : {}),
            ...(scenario === 'wrong-phone' ? { phone: '256700000012' } : {}),
            ...(scenario === 'verified-factor'
              ? { factors: [{ status: 'verified' }] }
              : {}),
          });
        if (path.endsWith('/session_context'))
          return Response.json(scenario === 'no-person' ? null : context);
        if (path.endsWith('/logout')) return Response.json({});
        throw new Error('Unexpected backend request');
      };
      const app = buildApp(config);
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/auth/invitation/accept',
          headers: { origin: config.webOrigin },
          payload,
        });
        const update = calls.find((call) => call.method === 'PUT');
        if (scenario === 'success') {
          assert.equal(response.statusCode, 200);
          assert.equal(response.json().user.requires_mfa, true);
          assert.deepEqual(update?.body, {
            password: deriveAuthPassword(phone, payload.pin, config.pinPepper),
          });
          assert.match(
            String(response.headers['set-cookie']),
            /HttpOnly; Secure; SameSite=Strict/,
          );
          assert(!response.body.includes('access'));
          assert(!response.body.includes(payload.pin));
        } else {
          assert(response.statusCode >= 400);
          assert.equal(response.headers['set-cookie'], undefined);
          assert.equal(!!update, scenario === 'password-failure');
          if (scenario !== 'invalid-code')
            assert(calls.some((call) => call.path.endsWith('/logout')));
        }
      } finally {
        await app.close();
        globalThis.fetch = original;
      }
    });
  }
});

test('invitation endpoints enforce origin, strict bodies and per-IP attempt limits', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ code: 'otp_expired' }, { status: 403 });
  };
  const app = buildApp(config);
  try {
    const send = (body: unknown, origin = config.webOrigin) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/invitation/accept',
        payload: body as object,
        headers: { origin },
      });
    assert.equal(
      (await send(payload, 'https://other.example')).statusCode,
      403,
    );
    assert.equal((await send({ ...payload, pin: 638291 })).statusCode, 400);
    assert.equal(
      (await send({ ...payload, role: 'fencher_admin' })).statusCode,
      400,
    );
    assert.equal(calls, 0);
    // Invalid bodies may consume the route limit, so use a fresh IP for this check.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push(
        (
          await app.inject({
            method: 'POST',
            url: '/api/auth/invitation/accept',
            remoteAddress: '192.0.2.10',
            payload,
            headers: { origin: config.webOrigin },
          })
        ).statusCode,
      );
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
    assert.equal(calls, 5);
  } finally {
    await app.close();
    globalThis.fetch = original;
  }
});
