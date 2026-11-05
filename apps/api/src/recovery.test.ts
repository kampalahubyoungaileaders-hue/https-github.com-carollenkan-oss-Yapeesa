import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { buildApp } from './app.js';
import type { ApiConfig } from './config.js';
import { deriveAuthPassword, sealTokens, openTokens } from './security.js';
import { openRecovery, sealRecovery } from './recovery.js';
const config: ApiConfig = {
  supabaseUrl: 'https://example.supabase.co',
  publishableKey: 'test',
  pinPepper: 'pepper'.repeat(8),
  gatewayKey: 'gateway'.repeat(8),
  cookieKey: randomBytes(32),
  webOrigin: 'https://yapesa.example',
  secureCookies: true,
};
const phone = '+256700000016';
const factor = '00000000-0000-4000-8000-000000000017';
test('recovery cookies expire and cannot be substituted for login cookies', () => {
  const state = {
    access: 'private-access',
    phone,
    started: 1000,
    changed: false,
  };
  const cookie = sealRecovery(state, config.cookieKey);
  assert(!cookie.includes('private-access'));
  assert.deepEqual(openRecovery(cookie, config.cookieKey, 1001), state);
  assert.throws(() => openRecovery(cookie, config.cookieKey, 601000));
  assert.throws(() => openRecovery(cookie, config.cookieKey, 999));
  assert.throws(() => openRecovery(cookie, randomBytes(32), 1001));
  assert.throws(() => openTokens(cookie, config.cookieKey));
  assert.throws(() =>
    openRecovery(
      sealTokens({ access_token: 'a', refresh_token: 'b' }, config.cookieKey),
      config.cookieKey,
    ),
  );
});
test('SMS recovery binds phone, enforces actual staff MFA and handles partial cleanup', async (t) => {
  for (const scenario of [
    'member',
    'staff',
    'pending',
    'wrong-phone',
    'unconfirmed',
    'missing-person',
    'bad-code',
    'cleanup-failure',
    'same-password',
    'revoked-factor',
  ])
    await t.test(scenario, async () => {
      const original = globalThis.fetch;
      let mfa = false;
      let failedCleanup = false;
      let writes = 0;
      let globalLogouts = 0;
      const staff = scenario === 'staff' || scenario === 'revoked-factor';
      let revoked = false;
      const calls: string[] = [];
      globalThis.fetch = async (input, options) => {
        const url = new URL(String(input));
        const path = url.pathname;
        calls.push(`${options?.method} ${path}${url.search}`);
        const body = options?.body
          ? (JSON.parse(String(options.body)) as Record<string, unknown>)
          : {};
        if (path === '/auth/v1/verify')
          return Response.json(
            scenario === 'bad-code'
              ? { code: 'otp_expired' }
              : { access_token: 'access', refresh_token: 'never-stored' },
            { status: scenario === 'bad-code' ? 403 : 200 },
          );
        if (path === '/auth/v1/user' && options?.method === 'PUT') {
          writes++;
          assert.deepEqual(body, {
            password: deriveAuthPassword(phone, '912864', config.pinPepper),
          });
          return Response.json(
            scenario === 'same-password'
              ? { code: 422, error_code: 'same_password' }
              : {},
            { status: scenario === 'same-password' ? 422 : 200 },
          );
        }
        if (path === '/auth/v1/user')
          return Response.json({
            phone: scenario === 'wrong-phone' ? '256700000019' : phone.slice(1),
            phone_confirmed_at:
              scenario === 'unconfirmed' ? null : '2026-11-05',
            app_metadata:
              scenario === 'pending' ? { yapesa_activation: 'pending' } : {},
            factors:
              staff && !revoked
                ? [{ id: factor, factor_type: 'totp', status: 'verified' }]
                : [],
          });
        if (path.endsWith('/session_context'))
          return Response.json(
            scenario === 'missing-person'
              ? null
              : { person_id: factor, requires_mfa: staff, mfa_verified: mfa },
          );
        if (path.endsWith('/challenge'))
          return Response.json({ id: 'challenge' });
        if (path.endsWith('/verify')) {
          mfa = true;
          return Response.json({
            access_token: 'mfa-access',
            refresh_token: 'not-stored',
          });
        }
        if (path.endsWith('/pin_attempt_clear')) return Response.json(null);
        if (path === '/auth/v1/logout') {
          if (url.searchParams.get('scope') === 'global') {
            globalLogouts++;
            if (scenario === 'cleanup-failure' && !failedCleanup) {
              failedCleanup = true;
              return Response.json({}, { status: 503 });
            }
          }
          return Response.json({});
        }
        throw new Error('Unexpected mocked call');
      };
      const app = buildApp(config);
      let cookie = '';
      const call = async (path: string, body: object) => {
        const response = await app.inject({
          method: 'POST',
          url: `/api/auth/recovery/${path}`,
          headers: { origin: config.webOrigin, ...(cookie ? { cookie } : {}) },
          payload: body,
        });
        const saved = response.cookies.find(
          (c) => c.name === 'yapesa_recovery',
        );
        if (saved?.value) cookie = `${saved.name}=${saved.value}`;
        return response;
      };
      try {
        const verify = await call('verify', { phone, code: '123456' });
        if (
          [
            'pending',
            'wrong-phone',
            'unconfirmed',
            'missing-person',
            'bad-code',
          ].includes(scenario)
        ) {
          assert(verify.statusCode >= 400, verify.body);
          assert.equal(cookie, '');
          assert.equal(writes, 0);
          return;
        }
        assert.equal(verify.statusCode, 200, verify.body);
        assert.match(
          String(verify.headers['set-cookie']),
          /Path=\/api\/auth\/recovery/,
        );
        assert.match(
          String(verify.headers['set-cookie']),
          /HttpOnly; Secure; SameSite=Strict/,
        );
        assert(!verify.body.includes('access'));
        assert(!String(verify.headers['set-cookie']).includes('never-stored'));
        assert.equal((await call('finish', {})).statusCode, 403);
        if (staff) {
          assert.equal(
            (await call('complete', { pin: '912864' })).statusCode,
            403,
          );
          assert.equal(writes, 0);
          assert.equal(
            (
              await call('mfa', {
                factor_id: '00000000-0000-4000-8000-000000000099',
                code: '123456',
              })
            ).statusCode,
            403,
          );
          assert.equal(
            (await call('mfa', { factor_id: factor, code: '123456' }))
              .statusCode,
            200,
          );
        }
        if (scenario === 'revoked-factor') {
          revoked = true;
          assert.equal(
            (await call('complete', { pin: '912864' })).statusCode,
            403,
          );
          assert.equal(writes, 0);
          return;
        }
        const completed = await call('complete', { pin: '912864' });
        assert.equal(completed.statusCode, 200, completed.body);
        assert.equal(writes, 1);
        assert.equal(
          completed.json().cleanup_complete,
          scenario !== 'cleanup-failure',
        );
        if (scenario === 'cleanup-failure') {
          assert.equal(
            (await call('finish', {})).json().cleanup_complete,
            true,
          );
          assert.equal(
            writes,
            1,
            'Cleanup retry must not change the password again',
          );
          assert.equal(globalLogouts, 2);
        }
        assert(calls.some((c) => c.includes('logout?scope=global')));
      } finally {
        await app.close();
        globalThis.fetch = original;
      }
    });
});
test('recovery SMS is explicit, never creates users and has strict origin/body/rate checks', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (input, options) => {
    assert.equal(new URL(String(input)).pathname, '/auth/v1/otp');
    assert.deepEqual(JSON.parse(String(options?.body)), {
      phone,
      create_user: false,
    });
    requests++;
    return Response.json({ code: 'user_not_found' }, { status: 403 });
  };
  const app = buildApp(config);
  try {
    await app.ready();
    assert.equal(requests, 0);
    const send = (body: object, origin = config.webOrigin, ip = '127.0.0.1') =>
      app.inject({
        method: 'POST',
        url: '/api/auth/recovery/code',
        headers: { origin },
        payload: body,
        remoteAddress: ip,
      });
    assert.equal(
      (await send({ phone }, 'https://attacker.invalid')).statusCode,
      403,
    );
    assert.equal(
      (await send({ phone, role: 'fencher_admin' })).statusCode,
      400,
    );
    assert.equal(requests, 0);
    for (let i = 0; i < 3; i++)
      assert.equal(
        (await send({ phone }, config.webOrigin, '127.0.0.2')).statusCode,
        200,
      );
    assert.equal(
      (await send({ phone }, config.webOrigin, '127.0.0.2')).statusCode,
      429,
    );
    assert.equal(requests, 3);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/recovery/complete',
          headers: { origin: config.webOrigin },
          payload: { pin: 912864 },
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
    globalThis.fetch = original;
  }
});
