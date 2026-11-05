import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../apps/api/src/app.js';
import { readConfig } from '../apps/api/src/config.js';
import { totp } from '../scripts/totp.js';

const env = process.env;
const config = readConfig();
assert(config);
for (const url of [config.supabaseUrl, env['TEST_DB_URL']!])
  assert(
    ['127.0.0.1', 'localhost'].includes(new URL(url).hostname),
    'Disposable recovery tests only',
  );
const app = buildApp(config);
const db = new pg.Client({ connectionString: env['TEST_DB_URL'] });
await db.connect();
test('real SMS OTP resets locked member/staff PINs, retains MFA and revokes old sessions', async () => {
  for (const label of ['REC_MEMBER', 'REC_STAFF']) {
    const phone = env[`TEST_${label}_PHONE`]!;
    const person = env[`TEST_${label}_PERSON`]!;
    const staff = label === 'REC_STAFF';
    const original = await db.query<{ id: string; encrypted_password: string }>(
      'select u.id,u.encrypted_password from auth.users u join public.person p on p.auth_user_id=u.id where p.id=$1',
      [person],
    );
    const user = original.rows[0]!;
    let cookie = '';
    let recovery = '';
    let requestCount = 0;
    const call = async (url: string, payload: object, override?: string) => {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: {
          origin: config!.webOrigin,
          cookie: override ?? (url.includes('/recovery/') ? recovery : cookie),
        },
        payload,
        remoteAddress: staff ? '127.0.0.42' : '127.0.0.41',
      });
      requestCount++;
      for (const value of response.cookies) {
        if (value.name === 'yapesa_session' && value.value)
          cookie = `${value.name}=${value.value}`;
        if (value.name === 'yapesa_recovery' && value.value)
          recovery = `${value.name}=${value.value}`;
      }
      return response;
    };
    try {
      const login = await call('/api/auth/login', {
        phone,
        pin: env['TEST_PIN'],
      });
      assert.equal(login.statusCode, 200, login.body);
      if (staff)
        assert.equal(
          (
            await call('/api/auth/mfa/verify', {
              factor_id: env['TEST_REC_STAFF_FACTOR'],
              code: totp(env['TEST_REC_STAFF_TOTP']!),
            })
          ).statusCode,
          200,
        );
      const oldCookie = cookie;
      for (let i = 0; i < 5; i++)
        assert.equal(
          (
            await call('/api/auth/login', {
              phone,
              pin: env['TEST_PIN'] === '000000' ? '000001' : '000000',
            })
          ).statusCode,
          401,
        );
      assert.equal(
        (await call('/api/auth/login', { phone, pin: env['TEST_PIN'] }))
          .statusCode,
        423,
      );
      assert.equal(
        (await call('/api/auth/recovery/complete', { pin: '912864' }))
          .statusCode,
        401,
      );
      const code = await call('/api/auth/recovery/code', { phone });
      assert.equal(code.statusCode, 200, code.body);
      assert.equal(
        (await call('/api/auth/recovery/verify', { phone, code: '000000' }))
          .statusCode,
        401,
      );
      const verified = await call('/api/auth/recovery/verify', {
        phone,
        code: env['TEST_RECOVERY_CODE'],
      });
      assert.equal(verified.statusCode, 200, verified.body);
      assert.equal(verified.json().requires_mfa, staff);
      assert(!verified.cookies.some((c) => c.name === 'yapesa_session'));
      const transplanted = recovery.replace(
        'yapesa_recovery=',
        'yapesa_session=',
      );
      assert.equal(
        (
          await app.inject({
            url: '/api/session',
            headers: { cookie: transplanted },
          })
        ).json().user,
        null,
      );
      if (staff) {
        assert.equal(
          (await call('/api/auth/recovery/complete', { pin: '912864' }))
            .statusCode,
          403,
        );
        const result = await call('/api/auth/recovery/mfa', {
          factor_id: env['TEST_REC_STAFF_FACTOR'],
          code: totp(env['TEST_REC_STAFF_TOTP']!),
        });
        assert.equal(result.statusCode, 200, result.body);
        assert.equal(result.json().mfa_verified, true);
      }
      const proof = recovery;
      const result = await call('/api/auth/recovery/complete', {
        pin: '912864',
      });
      assert.equal(result.statusCode, 200, result.body);
      assert.equal(result.json().cleanup_complete, true, result.body);
      assert.equal(
        (
          await app.inject({
            url: '/api/session',
            headers: { cookie: oldCookie },
          })
        ).json().user,
        null,
        'Existing cookie must lose access immediately',
      );
      assert.equal(
        (await call('/api/auth/recovery/complete', { pin: '712864' }, proof))
          .statusCode,
        401,
        'Revoked recovery proof cannot be replayed',
      );
      assert.equal(
        (await call('/api/auth/login', { phone, pin: env['TEST_PIN'] }))
          .statusCode,
        401,
      );
      const changed = await call('/api/auth/login', { phone, pin: '912864' });
      assert.equal(changed.statusCode, 200, changed.body);
      assert.equal(changed.json().user.requires_mfa, staff);
      assert.equal(changed.json().user.mfa_verified, false);
      const sessions = await db.query<{ count: string }>(
        'select count(*)::text as count from auth.sessions where user_id=$1',
        [user.id],
      );
      assert.equal(
        sessions.rows[0]!.count,
        '1',
        'Only the new PIN sign-in may remain',
      );
      assert(requestCount < 90);
    } finally {
      // Restore only these isolated fixtures so browser tests can start from the
      // original PIN. No hosted database is permitted by the loopback guard.
      await db.query(
        'update auth.users set encrypted_password=$1 where id=$2',
        [user.encrypted_password, user.id],
      );
      await db.query('delete from auth.sessions where user_id=$1', [user.id]);
      await db.query('delete from private.pin_attempt where phone=$1', [phone]);
    }
  }
});
test.after(async () => {
  await app.close();
  await db.end();
});
