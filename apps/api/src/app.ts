import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { calcVersion, money, shareJournal } from '@yapesa/domain';
import type { ApiConfig } from './config.js';
import { Backend, ApiError, object, textField, tokensFrom } from './backend.js';
import {
  deriveAuthPassword,
  openTokens,
  sealTokens,
  type Tokens,
} from './security.js';
import {
  sessionSchema,
  groupSchema,
  workspaceSchema,
  purchaseBody,
  receiptSchema,
  factorSchema,
  errorSchema,
  phonePinBody,
  mfaBody,
} from './schema.js';
interface Context {
  person_id: string;
  display_name: string;
  requires_mfa: boolean;
  mfa_verified: boolean;
}
interface Identity {
  tokens: Tokens;
  context: Context;
  factors: { id: string; name: string }[];
}
const COOKIE = 'yapesa_session';
export function buildApp(config?: ApiConfig) {
  const app = Fastify({
    logger: false,
    bodyLimit: 8192,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const backend = config ? new Backend(config) : undefined;
  app.register(cookie);
  app.register(rateLimit, { max: 90, timeWindow: '1 minute' });
  app.register(swagger, {
    openapi: { info: { title: 'Yapesa API', version: '0.1.0' } },
  });
  app.setErrorHandler((error, _request, reply) => {
    const err = error as Error & { validation?: unknown; statusCode?: number };
    if (error instanceof ApiError)
      return reply.code(error.status).send({ error: error.code });
    if (err.validation)
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    if (err.statusCode === 429)
      return reply.code(429).send({ error: 'TOO_MANY_ATTEMPTS' });
    return reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff');
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        (!config || request.headers.origin !== config.webOrigin)
      )
        throw new ApiError(
          config ? 403 : 503,
          config ? 'INVALID_ORIGIN' : 'AUTH_NOT_CONFIGURED',
        );
    }
  });
  const configured = () => {
    if (!config || !backend) throw new ApiError(503, 'AUTH_NOT_CONFIGURED');
    return { config, backend };
  };
  const setTokens = (reply: FastifyReply, tokens: Tokens) => {
    const { config } = configured();
    reply.setCookie(COOKIE, sealTokens(tokens, config.cookieKey), {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'strict',
      path: '/api',
    });
  };
  const clearTokens = (reply: FastifyReply) =>
    reply.clearCookie(COOKIE, {
      path: '/api',
      httpOnly: true,
      sameSite: 'strict',
      secure: config?.secureCookies ?? false,
    });
  async function identity(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Identity> {
    const { config, backend } = configured();
    const raw = request.cookies[COOKIE];
    if (!raw) throw new ApiError(401, 'AUTH_REQUIRED');
    let tokens: Tokens;
    try {
      tokens = openTokens(raw, config.cookieKey);
    } catch {
      throw new ApiError(401, 'AUTH_REQUIRED');
    }
    let user: Record<string, unknown>;
    try {
      user = object(await backend.auth('user', undefined, tokens.access_token));
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      tokens = tokensFrom(
        await backend.auth('token?grant_type=refresh_token', {
          refresh_token: tokens.refresh_token,
        }),
      );
      user = object(await backend.auth('user', undefined, tokens.access_token));
      setTokens(reply, tokens);
    }
    const rawContext = await backend.rpc(
      'session_context',
      {},
      tokens.access_token,
    );
    if (!rawContext) throw new ApiError(401, 'AUTH_REQUIRED');
    const data = object(rawContext);
    if (
      typeof data['requires_mfa'] !== 'boolean' ||
      typeof data['mfa_verified'] !== 'boolean'
    )
      throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
    const context: Context = {
      person_id: textField(data, 'person_id'),
      display_name: textField(data, 'display_name'),
      requires_mfa: data['requires_mfa'],
      mfa_verified: data['mfa_verified'],
    };
    const factors = Array.isArray(user['factors'])
      ? user['factors'].flatMap((item: unknown) => {
          const factor = object(item);
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
    return { tokens, context, factors };
  }
  async function authorised(request: FastifyRequest, reply: FastifyReply) {
    const user = await identity(request, reply);
    if (user.context.requires_mfa && !user.context.mfa_verified)
      throw new ApiError(403, 'MFA_REQUIRED');
    return user;
  }
  const session = (user: Identity) => ({
    configured: true,
    user: { ...user.context, factors: user.factors },
  });
  app.after(() => {
    const errors = {
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      409: errorSchema,
      422: errorSchema,
      429: errorSchema,
      503: errorSchema,
    };
    app.get(
      '/health',
      {
        schema: {
          response: {
            200: {
              type: 'object',
              additionalProperties: false,
              required: ['status'],
              properties: { status: { type: 'string', const: 'ok' } },
            },
          },
        },
      },
      async () => ({ status: 'ok' as const }),
    );
    app.get(
      '/api/session',
      { schema: { response: { 200: sessionSchema, ...errors } } },
      async (request, reply) => {
        if (!config) return { configured: false, user: null };
        try {
          return session(await identity(request, reply));
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            clearTokens(reply);
            return { configured: true, user: null };
          }
          throw error;
        }
      },
    );
    app.post<{ Body: { phone: string; pin: string } }>(
      '/api/auth/login',
      {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: {
          body: phonePinBody,
          response: { 200: sessionSchema, ...errors, 423: errorSchema },
        },
      },
      async (request, reply) => {
        const { config, backend } = configured();
        const { phone, pin } = request.body;
        if (
          (await backend.rpc(
            'pin_attempt_begin',
            { p_phone: phone },
            undefined,
            true,
          )) !== true
        )
          throw new ApiError(423, 'PIN_LOCKED');
        let tokens: Tokens;
        try {
          tokens = tokensFrom(
            await backend.auth('token?grant_type=password', {
              phone,
              password: deriveAuthPassword(phone, pin, config.pinPepper),
            }),
          );
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401) {
            await backend.rpc(
              'pin_attempt_release',
              { p_phone: phone },
              undefined,
              true,
            );
          }
          throw error;
        }
        await backend.rpc(
          'pin_attempt_clear',
          { p_phone: phone },
          undefined,
          true,
        );
        setTokens(reply, tokens);
        // Return context via the same verified Auth and database checks as any request.
        request.cookies[COOKIE] = sealTokens(tokens, config.cookieKey);
        return session(await identity(request, reply));
      },
    );
    app.post(
      '/api/auth/logout',
      {
        schema: {
          response: {
            200: {
              type: 'object',
              required: ['ok'],
              properties: { ok: { type: 'boolean' } },
            },
            ...errors,
          },
        },
      },
      async (request, reply) => {
        try {
          const user = await identity(request, reply);
          await configured().backend.auth(
            'logout?scope=local',
            {},
            user.tokens.access_token,
          );
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401) throw error;
        } finally {
          clearTokens(reply);
        }
        return { ok: true };
      },
    );
    app.post(
      '/api/auth/mfa/enroll',
      { schema: { response: { 200: factorSchema, ...errors } } },
      async (request, reply) => {
        const user = await identity(request, reply);
        if (user.factors.length && !user.context.mfa_verified)
          throw new ApiError(403, 'MFA_REQUIRED');
        const factor = object(
          await configured().backend.auth(
            'factors',
            {
              factor_type: 'totp',
              friendly_name: 'Yapesa authenticator',
              issuer: 'Yapesa',
            },
            user.tokens.access_token,
          ),
        );
        const totp = object(factor['totp']);
        return {
          id: textField(factor, 'id'),
          secret: textField(totp, 'secret'),
          uri: textField(totp, 'uri'),
        };
      },
    );
    app.post<{ Body: { factor_id: string; code: string } }>(
      '/api/auth/mfa/verify',
      {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: { body: mfaBody, response: { 200: sessionSchema, ...errors } },
      },
      async (request, reply) => {
        const user = await identity(request, reply);
        const { backend, config } = configured();
        const factorId = request.body.factor_id;
        const challenge = object(
          await backend.auth(
            `factors/${encodeURIComponent(factorId)}/challenge`,
            {},
            user.tokens.access_token,
          ),
        );
        const tokens = tokensFrom(
          await backend.auth(
            `factors/${encodeURIComponent(factorId)}/verify`,
            {
              challenge_id: textField(challenge, 'id'),
              code: request.body.code,
            },
            user.tokens.access_token,
          ),
        );
        setTokens(reply, tokens);
        request.cookies[COOKIE] = sealTokens(tokens, config.cookieKey);
        return session(await identity(request, reply));
      },
    );
    app.get(
      '/api/groups',
      {
        schema: {
          response: { 200: { type: 'array', items: groupSchema }, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        return configured().backend.rpc(
          'list_my_groups',
          {},
          user.tokens.access_token,
        );
      },
    );
    app.get<{ Params: { id: string } }>(
      '/api/groups/:id',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          response: { 200: workspaceSchema, ...errors, 404: errorSchema },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        const result = await configured().backend.rpc(
          'group_workspace',
          { p_org: request.params.id },
          user.tokens.access_token,
        );
        if (!result) throw new ApiError(404, 'GROUP_NOT_FOUND');
        return result;
      },
    );
    interface Purchase {
      member_id: string;
      meeting_date: string;
      shares: string;
      client_id: string;
      device_id: string;
      client_amount: string;
      client_calc_version: string;
      note: string;
    }
    app.post<{ Params: { id: string }; Body: Purchase }>(
      '/api/groups/:id/shares',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          body: purchaseBody,
          response: { 200: receiptSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        const { backend } = configured();
        const group = object(
          await backend.rpc(
            'group_workspace',
            { p_org: request.params.id },
            user.tokens.access_token,
          ),
        );
        const metadata = object(group['group']);
        const cycle = object(group['cycle']);
        const input = request.body;
        // Use the shared calculator in the API, then independently recheck/post in SQL.
        try {
          shareJournal(
            input.client_id,
            money(
              BigInt(textField(cycle, 'share_price')),
              textField(metadata, 'currency'),
            ),
            BigInt(input.shares),
          );
        } catch {
          throw new ApiError(422, 'INVALID_SHARE_PURCHASE');
        }
        return backend.rpc(
          'post_share_purchase',
          {
            p_org: request.params.id,
            p_member: input.member_id,
            p_date: input.meeting_date,
            p_shares: input.shares,
            p_client: input.client_id,
            p_device: input.device_id,
            p_client_amount: input.client_amount,
            p_client_version: input.client_calc_version,
            p_note: input.note,
          },
          user.tokens.access_token,
        );
      },
    );
    app.get(
      '/api/calculation-version',
      {
        schema: {
          response: {
            200: {
              type: 'object',
              required: ['calc_version'],
              properties: { calc_version: { type: 'string' } },
            },
          },
        },
      },
      async () => ({ calc_version: calcVersion }),
    );
  });
  return app;
}
