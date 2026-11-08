import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiConfig } from './config.js';
import { ApiError, Backend, object, textField, tokensFrom } from './backend.js';
import { deriveAuthPassword } from './security.js';
import { pendingInvitation } from './invitation.js';
import {
  errorSchema,
  invitationPhoneBody,
  mfaBody,
  recoveryCodeBody,
  recoveryPinBody,
  recoverySchema,
  factorSchema,
  recoveryRequestBody,
  adminResultSchema,
  recoveryResultSchema,
} from './schema.js';

const COOKIE = 'yapesa_recovery';
const PATH = '/api/auth/recovery';
const PURPOSE = Buffer.from('yapesa-pin-recovery-v1');
export interface RecoveryState {
  access: string;
  phone: string;
  started: number;
  changed: boolean;
  newFactor?: string;
}
export function sealRecovery(state: RecoveryState, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(PURPOSE);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(state), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}
export function openRecovery(
  raw: string,
  key: Buffer,
  now = Date.now(),
): RecoveryState {
  if (raw.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(raw))
    throw new ApiError(401, 'RECOVERY_EXPIRED');
  try {
    const bytes = Buffer.from(raw, 'base64url');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      bytes.subarray(0, 12),
    );
    decipher.setAAD(PURPOSE);
    decipher.setAuthTag(bytes.subarray(12, 28));
    const state = object(
      JSON.parse(
        Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString('utf8'),
      ),
    );
    if (
      typeof state['access'] !== 'string' ||
      typeof state['phone'] !== 'string' ||
      !/^\+[1-9][0-9]{6,14}$/.test(state['phone']) ||
      typeof state['changed'] !== 'boolean' ||
      (state['newFactor'] !== undefined &&
        (typeof state['newFactor'] !== 'string' ||
          !/^[a-f0-9-]{36}$/i.test(state['newFactor']))) ||
      typeof state['started'] !== 'number' ||
      !Number.isFinite(state['started']) ||
      state['started'] > now ||
      now - state['started'] >= 600000
    )
      throw new Error('Expired');
    return {
      access: state['access'],
      phone: state['phone'],
      started: state['started'],
      changed: state['changed'],
      ...(typeof state['newFactor'] === 'string'
        ? { newFactor: state['newFactor'] }
        : {}),
    };
  } catch {
    throw new ApiError(401, 'RECOVERY_EXPIRED');
  }
}

export function registerRecovery(
  app: FastifyInstance,
  config: ApiConfig | undefined,
  clearSession: (reply: FastifyReply) => unknown,
) {
  const configured = () => {
    if (!config) throw new ApiError(503, 'AUTH_NOT_CONFIGURED');
    return { config, backend: new Backend(config) };
  };
  const errors = {
    400: errorSchema,
    401: errorSchema,
    403: errorSchema,
    409: errorSchema,
    429: errorSchema,
    503: errorSchema,
    502: errorSchema,
  };
  const ok = {
    type: 'object',
    additionalProperties: false,
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
  };
  const empty = { type: 'object', additionalProperties: false };
  const clear = (reply: FastifyReply) =>
    reply.clearCookie(COOKIE, {
      path: PATH,
      httpOnly: true,
      secure: config?.secureCookies ?? false,
      sameSite: 'strict',
    });
  const save = (reply: FastifyReply, state: RecoveryState) => {
    const { config } = configured();
    reply.setCookie(COOKIE, sealRecovery(state, config.cookieKey), {
      path: PATH,
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'strict',
      maxAge: Math.max(
        0,
        Math.floor((state.started + 600000 - Date.now()) / 1000),
      ),
    });
  };
  const read = (request: FastifyRequest) => {
    const { config } = configured();
    const raw = request.cookies[COOKIE];
    if (!raw) throw new ApiError(401, 'RECOVERY_EXPIRED');
    return openRecovery(raw, config.cookieKey);
  };
  async function identity(state: RecoveryState) {
    const { backend } = configured();
    const user = object(await backend.auth('user', undefined, state.access));
    if (
      pendingInvitation(user) ||
      !user['phone_confirmed_at'] ||
      user['phone'] !== state.phone.slice(1)
    )
      throw new ApiError(403, 'RECOVERY_UNAVAILABLE');
    const raw = await backend.rpc('session_context', {}, state.access);
    if (!raw) throw new ApiError(401, 'RECOVERY_EXPIRED');
    const context = object(raw);
    if (
      typeof context['requires_mfa'] !== 'boolean' ||
      typeof context['mfa_verified'] !== 'boolean'
    )
      throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
    const factors = Array.isArray(user['factors'])
      ? user['factors'].flatMap((raw: unknown) => {
          const factor = object(raw);
          return factor['factor_type'] === 'totp' &&
            factor['status'] === 'verified'
            ? [
                {
                  id: textField(factor, 'id'),
                  name:
                    typeof factor['friendly_name'] === 'string'
                      ? factor['friendly_name']
                      : 'Authenticator',
                },
              ]
            : [];
        })
      : [];
    const requires_mfa = context['requires_mfa'] || factors.length > 0;
    if (requires_mfa && !factors.length) {
      const reset = object(
        await backend.rpc('mfa_recovery_state', {}, state.access),
      );
      if (reset['can_enroll'] !== true)
        throw new ApiError(403, 'RECOVERY_UNAVAILABLE');
      return {
        requires_mfa,
        mfa_verified: false,
        factors,
        enrollment_allowed: true,
      };
    }
    return { requires_mfa, mfa_verified: context['mfa_verified'], factors };
  }
  async function finish(state: RecoveryState, reply: FastifyReply) {
    if (!state.changed) throw new ApiError(403, 'RECOVERY_UNAVAILABLE');
    const { backend } = configured();
    try {
      const user = await identity(state);
      if (user.requires_mfa && !user.mfa_verified)
        throw new ApiError(403, 'MFA_REQUIRED');
      await backend.rpc(
        'pin_attempt_clear',
        { p_phone: state.phone },
        undefined,
        true,
      );
      await backend.auth('logout?scope=global', {}, state.access);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        // Password change is already confirmed. Preserve a bounded retry handle,
        // and never tell the user to submit their new PIN again for cleanup.
        save(reply, state);
        clearSession(reply);
        return { ok: true, cleanup_complete: false };
      }
    }
    clear(reply);
    clearSession(reply);
    return { ok: true, cleanup_complete: true };
  }
  app.post<{ Body: { phone: string } }>(
    `${PATH}/code`,
    {
      config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
      schema: { body: invitationPhoneBody, response: { 200: ok, ...errors } },
    },
    async (request) => {
      try {
        await configured().backend.auth('otp', {
          phone: request.body.phone,
          create_user: false,
        });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
      return { ok: true };
    },
  );
  app.post<{ Body: { phone: string; code: string } }>(
    `${PATH}/verify`,
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        body: recoveryCodeBody,
        response: { 200: recoverySchema, ...errors },
      },
    },
    async (request, reply) => {
      const { backend } = configured();
      const tokens = tokensFrom(
        await backend.auth('verify', {
          phone: request.body.phone,
          token: request.body.code,
          type: 'sms',
        }),
      );
      const state: RecoveryState = {
        access: tokens.access_token,
        phone: request.body.phone,
        started: Date.now(),
        changed: false,
      };
      try {
        const result = await identity(state);
        save(reply, state);
        return result;
      } catch (error) {
        try {
          await backend.auth('logout?scope=local', {}, state.access);
        } catch {
          /* No recovery cookie was issued. */
        }
        throw error;
      }
    },
  );
  app.post<{ Body: { factor_id: string; code: string } }>(
    `${PATH}/mfa`,
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: { body: mfaBody, response: { 200: recoverySchema, ...errors } },
    },
    async (request, reply) => {
      const state = read(request);
      if (state.changed) throw new ApiError(403, 'RECOVERY_UNAVAILABLE');
      const user = await identity(state);
      if (
        !user.factors.some((factor) => factor.id === request.body.factor_id) &&
        !(user.enrollment_allowed && state.newFactor === request.body.factor_id)
      )
        throw new ApiError(403, 'MFA_REQUIRED');
      const { backend } = configured();
      const path = `factors/${encodeURIComponent(request.body.factor_id)}`;
      const challenge = object(
        await backend.auth(`${path}/challenge`, {}, state.access),
      );
      const tokens = tokensFrom(
        await backend.auth(
          `${path}/verify`,
          { challenge_id: textField(challenge, 'id'), code: request.body.code },
          state.access,
        ),
      );
      const next = { ...state, access: tokens.access_token };
      if (state.newFactor)
        await backend.rpc('mfa_recovery_finish', {}, next.access, true);
      const result = await identity(next);
      if (!result.mfa_verified) throw new ApiError(403, 'MFA_REQUIRED');
      save(reply, next);
      return result;
    },
  );
  app.post<{ Body: { request_id: string; reason: string } }>(
    `${PATH}/lost-authenticator`,
    {
      schema: {
        body: recoveryRequestBody,
        response: { 200: adminResultSchema, ...errors },
      },
    },
    async (request) => {
      const state = read(request);
      if (state.changed) throw new ApiError(403, 'RECOVERY_UNAVAILABLE');
      const user = await identity(state);
      if (!user.requires_mfa || !user.factors.length)
        throw new ApiError(403, 'RECOVERY_UNAVAILABLE');
      return configured().backend.rpc(
        'mfa_recovery_request',
        { p_request: request.body.request_id, p_reason: request.body.reason },
        state.access,
        true,
      );
    },
  );
  app.post(
    `${PATH}/enroll`,
    { schema: { body: empty, response: { 200: factorSchema, ...errors } } },
    async (request, reply) => {
      const state = read(request);
      if (state.changed) throw new ApiError(403, 'RECOVERY_UNAVAILABLE');
      const user = await identity(state);
      if (!user.enrollment_allowed)
        throw new ApiError(403, 'RECOVERY_UNAVAILABLE');
      const factor = object(
        await configured().backend.auth(
          'factors',
          {
            factor_type: 'totp',
            friendly_name: 'Yapesa recovered authenticator',
            issuer: 'Yapesa',
          },
          state.access,
        ),
      );
      const totp = object(factor['totp']);
      const id = textField(factor, 'id');
      save(reply, { ...state, newFactor: id });
      return {
        id,
        secret: textField(totp, 'secret'),
        uri: textField(totp, 'uri'),
      };
    },
  );
  app.post<{ Body: { pin: string } }>(
    `${PATH}/complete`,
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        body: recoveryPinBody,
        response: { 200: recoveryResultSchema, ...errors },
      },
    },
    async (request, reply) => {
      const state = read(request);
      if (state.changed) return finish(state, reply);
      const user = await identity(state);
      if (user.requires_mfa && !user.mfa_verified)
        throw new ApiError(403, 'MFA_REQUIRED');
      const { backend, config } = configured();
      try {
        await backend.request(
          '/auth/v1/user',
          'PUT',
          {
            password: deriveAuthPassword(
              state.phone,
              request.body.pin,
              config.pinPepper,
            ),
          },
          state.access,
        );
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'PIN_UNCHANGED')
          throw error;
      }
      const changed = { ...state, changed: true };
      return finish(changed, reply);
    },
  );
  app.post(
    `${PATH}/finish`,
    {
      schema: {
        body: empty,
        response: { 200: recoveryResultSchema, ...errors },
      },
    },
    async (request, reply) => finish(read(request), reply),
  );
  app.post(
    `${PATH}/cancel`,
    { schema: { body: empty, response: { 200: ok, ...errors } } },
    async (request, reply) => {
      try {
        const state = read(request);
        await configured().backend.auth('logout?scope=local', {}, state.access);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
      clear(reply);
      return { ok: true };
    },
  );
}
