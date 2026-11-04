import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ClientError } from '../src/index.js';

test('statement downloads preserve member filter and surface safe API errors', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/groups/group-a/statement.pdf?member_id=member-a');
      assert.equal(options?.credentials, 'same-origin');
      return new Response('%PDF-1.3', {
        headers: { 'Content-Type': 'application/pdf' },
      });
    };
    assert.equal(
      await (await api.statement('group-a', 'member-a')).text(),
      '%PDF-1.3',
    );
    globalThis.fetch = async () =>
      Response.json({ error: 'PERMISSION_DENIED' }, { status: 403 });
    await assert.rejects(
      api.statement('group-a'),
      (error: unknown) =>
        error instanceof ClientError &&
        error.status === 403 &&
        error.code === 'PERMISSION_DENIED',
    );
    globalThis.fetch = async () =>
      new Response('<html>private loading details</html>');
    await assert.rejects(
      api.statement('group-a'),
      (error: unknown) =>
        error instanceof ClientError && error.code === 'BACKEND_UNAVAILABLE',
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('uncertain transport failures and HTML host responses never retry login', async () => {
  const original = globalThis.fetch;
  try {
    for (const failure of ['timeout', 'html']) {
      let calls = 0;
      globalThis.fetch = async (_url, options) => {
        calls++;
        assert.equal(options?.method, 'POST');
        assert(options?.signal instanceof AbortSignal);
        if (failure === 'timeout')
          throw new DOMException('private details', 'TimeoutError');
        return new Response('<html>private host details</html>', {
          status: 503,
        });
      };
      await assert.rejects(
        api.login('+256700000011', '638291'),
        (error: unknown) => {
          assert(error instanceof ClientError);
          assert.equal(
            error.code,
            failure === 'timeout' ? 'NETWORK_ERROR' : 'BACKEND_UNAVAILABLE',
          );
          assert(!error.message.includes('private'));
          return true;
        },
      );
      assert.equal(calls, 1);
    }
    globalThis.fetch = async () =>
      Response.json({ error: 'PIN_LOCKED' }, { status: 423 });
    await assert.rejects(
      api.login('+256700000011', '638291'),
      (error: unknown) => {
        assert(error instanceof ClientError);
        assert.equal(error.status, 423);
        assert.equal(error.code, 'PIN_LOCKED');
        return true;
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});
