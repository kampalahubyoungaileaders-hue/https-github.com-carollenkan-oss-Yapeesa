import test from 'node:test';
import assert from 'node:assert/strict';
import { Webhook } from 'standardwebhooks';
import { createSmsHandler, type SmsConfig } from '../egosms-auth/handler.ts';

// Synthetic signing/delivery credentials; no test calls any SMS provider.
const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;
const config: SmsConfig = {
  username: 'fixture-user',
  password: 'fixture-password',
  senderId: undefined,
  hookSecret: `v1,${secret}`,
};
const data = { user: { phone: '+256700000001' }, sms: { otp: '123456' } };
function signed(value: unknown = data, date = new Date(), id = 'fixture-hook') {
  const payload = JSON.stringify(value);
  return new Request('https://example.invalid/hook', {
    method: 'POST',
    body: payload,
    headers: {
      'webhook-id': id,
      'webhook-timestamp': String(Math.floor(date.getTime() / 1000)),
      'webhook-signature': new Webhook(secret).sign(id, date, payload),
    },
  });
}
test('unsigned, forged, expired and tampered hooks never send SMS', async () => {
  let calls = 0;
  const handler = createSmsHandler(config, async () => {
    calls++;
    return Response.json({ Status: 'OK' });
  });
  assert.equal(
    (await handler(new Request('https://example.invalid'))).status,
    405,
  );
  assert.equal(
    (
      await handler(
        new Request('https://example.invalid', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      )
    ).status,
    401,
  );
  const forged = signed();
  forged.headers.set('webhook-signature', 'v1,forged');
  assert.equal((await handler(forged)).status, 401);
  assert.equal(
    (await handler(signed(data, new Date(Date.now() - 600000)))).status,
    401,
  );
  const good = signed();
  const changed = new Request(good.url, {
    method: 'POST',
    headers: good.headers,
    body: JSON.stringify({ ...data, sms: { otp: '999999' } }),
  });
  assert.equal((await handler(changed)).status, 401);
  assert.equal(calls, 0);
});
test('signed OTP becomes the documented EgoSMS request; default sender is omitted', async () => {
  let calls = 0;
  const handler = createSmsHandler(config, async (url, options) => {
    calls++;
    assert.equal(url, 'https://comms.egosms.co/api/v1/json/');
    assert.equal(options?.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert(options.signal);
    assert.deepEqual(JSON.parse(String(options.body)), {
      method: 'SendSms',
      userdata: { username: 'fixture-user', password: 'fixture-password' },
      msgdata: [
        {
          number: '256700000001',
          message:
            'Your Yapesa verification code is 123456. Do not share this code.',
          priority: 1,
        },
      ],
    });
    return Response.json({
      Status: 'OK',
      Cost: 35,
      MsgFollowUpUniqueCode: 'fixture',
    });
  });
  const response = await handler(signed());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {});
  assert.equal(calls, 1);
});
test('configured sender is forwarded and unsigned configuration errors reveal no secrets', async () => {
  const handler = createSmsHandler(
    { ...config, senderId: 'EgoSMS' },
    async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as {
        msgdata: { senderid: string }[];
      };
      assert.equal(body.msgdata[0]?.senderid, 'EgoSMS');
      return Response.json({ Status: 'OK' });
    },
  );
  assert.equal((await handler(signed())).status, 200);
  const missing = createSmsHandler(
    { ...config, password: undefined },
    async () => {
      throw new Error('must not send');
    },
  );
  const result = await missing(signed());
  assert.equal(result.status, 503);
  assert(!(await result.text()).includes(config.username!));
});
test('bad recipients, codes, payload sizes and sender configuration never call the provider', async () => {
  let calls = 0;
  const send: typeof fetch = async () => {
    calls++;
    return Response.json({ Status: 'OK' });
  };
  const handler = createSmsHandler(config, send);
  for (const value of [
    null,
    {},
    { user: { phone: '0700000001' }, sms: { otp: '123456' } },
    { user: { phone: '+256700000001' }, sms: { otp: 123456 } },
    { user: { phone: '+256700000001' }, sms: { otp: '<script>' } },
  ])
    assert.equal((await handler(signed(value))).status, 400);
  assert.equal(
    (await handler(signed({ ...data, padding: 'x'.repeat(20000) }))).status,
    413,
  );
  assert.equal(
    (
      await createSmsHandler(
        { ...config, senderId: 'too-long-sender-id' },
        send,
      )(signed())
    ).status,
    503,
  );
  assert.equal(calls, 0);
});
test('provider rejection, malformed responses and transport failures fail without leaking or retrying', async () => {
  for (const send of [
    async () =>
      Response.json({ Status: 'Failed', Message: 'fixture-password' }),
    async () => new Response('fixture-password', { status: 401 }),
    async () => new Response('not json'),
    async () => {
      throw new Error('fixture-password');
    },
  ]) {
    let calls = 0;
    const result = await createSmsHandler(config, async () => {
      calls++;
      return send();
    })(signed());
    assert.equal(result.status, 502);
    assert.equal(calls, 1);
    const output = await result.text();
    assert(!output.includes('fixture-password'));
    assert(!output.includes('123456'));
  }
});
