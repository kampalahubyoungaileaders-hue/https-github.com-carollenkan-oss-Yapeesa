import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import staticFiles from '@fastify/static';
import { calcVersion, money, shareJournal } from '@yapesa/domain';
import type { ApiConfig } from './config.js';
import { Backend, ApiError, object, textField, tokensFrom } from './backend.js';
import { acceptInvitation, pendingInvitation } from './invitation.js';
import { renderStatement, statementData } from './statement.js';
import { registerRecovery } from './recovery.js';
import { checkedFinalShareout } from './final-shareout.js';
import { checkedShareOut } from './shareout.js';
import { checkedMeetings } from './meeting.js';
import { checkedLoans, checkedLoanQuote } from './loans.js';
import { checkedFines } from './fines.js';
import { checkedSocial } from './social.js';
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
  reversalBody,
  shareoutSchema,
  finalShareoutSchema,
  finalShareoutBody,
  meetingCommandBody,
  meetingWorkspaceSchema,
  loanPolicyBody,
  loanQuoteBody,
  loanQuoteSchema,
  loanCommandBody,
  loanWorkspaceSchema,
  finePolicyBody,
  fineCommandBody,
  fineWorkspaceSchema,
  socialRuleBody,
  socialCommandBody,
  socialWorkspaceSchema,
  receiptSchema,
  factorSchema,
  errorSchema,
  phonePinBody,
  mfaBody,
  invitationPhoneBody,
  invitationBody,
  adminWorkspaceSchema,
  adminNewCycleBody,
  reviewWorkspaceSchema,
  reviewCommandBody,
  adminResultSchema,
  adminGroupBody,
  adminConfigurationBody,
  adminMemberBody,
  adminRoleBody,
} from './schema.js';
interface Context {
  person_id: string;
  display_name: string;
  requires_mfa: boolean;
  mfa_verified: boolean;
  can_administer: boolean;
}
interface Identity {
  tokens: Tokens;
  context: Context;
  factors: { id: string; name: string }[];
}
const COOKIE = 'yapesa_session';
export function buildApp(config?: ApiConfig, webRoot?: string) {
  const app = Fastify({
    logger: false,
    trustProxy: config?.trustedProxyHops
      ? (_address: string, hop: number) => hop < config.trustedProxyHops!
      : false,
    bodyLimit: 8192,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const backend = config ? new Backend(config) : undefined;
  app.register(cookie);
  app.register(rateLimit, { max: 90, timeWindow: '1 minute' });
  app.register(swagger, {
    openapi: { info: { title: 'Yapesa API', version: '0.1.0' } },
  });
  if (webRoot) {
    app.addHook('onRequest', async (_request, reply) => {
      reply
        .header('X-Content-Type-Options', 'nosniff')
        .header('Referrer-Policy', 'no-referrer')
        .header(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        );
    });
    app.register(staticFiles, {
      root: webRoot,
      index: ['index.html'],
      dotfiles: 'deny',
      maxAge: 0,
    });
  }
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
      requires_mfa: data['requires_mfa'] || pendingInvitation(user),
      mfa_verified: data['mfa_verified'],
      can_administer: data['can_administer'] === true,
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
  async function administrator(request: FastifyRequest, reply: FastifyReply) {
    const user = await authorised(request, reply);
    if (!user.context.can_administer)
      throw new ApiError(403, 'PERMISSION_DENIED');
    return user;
  }
  app.after(() => {
    registerRecovery(app, config, clearTokens);
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
    app.post<{ Body: { phone: string } }>(
      '/api/auth/invitation/code',
      {
        config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
        schema: {
          body: invitationPhoneBody,
          response: {
            200: {
              type: 'object',
              properties: { ok: { type: 'boolean' } },
              required: ['ok'],
            },
            ...errors,
          },
        },
      },
      async (request) => {
        await configured().backend.auth('resend', {
          phone: request.body.phone,
          type: 'sms',
        });
        return { ok: true };
      },
    );
    app.post<{ Body: { phone: string; code: string; pin: string } }>(
      '/api/auth/invitation/accept',
      {
        config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
        schema: {
          body: invitationBody,
          response: { 200: sessionSchema, ...errors },
        },
      },
      async (request, reply) => {
        const { backend, config } = configured();
        const tokens = await acceptInvitation(backend, request.body);
        request.cookies[COOKIE] = sealTokens(tokens, config.cookieKey);
        const result = session(await identity(request, reply));
        setTokens(reply, tokens);
        return result;
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
    app.get<{ Params: { id: string }; Querystring: { member_id?: string } }>(
      '/api/groups/:id/statement.pdf',
      {
        config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
        schema: {
          params: {
            type: 'object',
            additionalProperties: false,
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          querystring: {
            type: 'object',
            additionalProperties: false,
            properties: { member_id: { type: 'string', format: 'uuid' } },
          },
          response: {
            200: {
              description: 'Share purchase statement',
              content: {
                'application/pdf': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            ...errors,
            404: errorSchema,
          },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        const workspace = await configured().backend.rpc(
          'group_workspace',
          { p_org: request.params.id },
          user.tokens.access_token,
        );
        if (!workspace) throw new ApiError(404, 'GROUP_NOT_FOUND');
        const statement = statementData(workspace, request.query.member_id);
        const pdf = await renderStatement(statement);
        return reply
          .type('application/pdf')
          .header(
            'Content-Disposition',
            `attachment; filename="yapesa-${request.params.id}.pdf"`,
          )
          .header('Cross-Origin-Resource-Policy', 'same-origin')
          .send(pdf);
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
        const cycle = group['cycle'] === null ? null : object(group['cycle']);
        const input = request.body;
        // Use the shared calculator in the API, then independently recheck/post in SQL.
        try {
          if (cycle)
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
    app.post<{
      Params: { id: string };
      Body: {
        transaction_id: string;
        client_id: string;
        device_id: string;
        reason: string;
      };
    }>(
      '/api/groups/:id/reversals',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          body: reversalBody,
          response: { 200: receiptSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        const input = request.body;
        return configured().backend.rpc(
          'reverse_share_purchase',
          {
            p_org: request.params.id,
            p_transaction: input.transaction_id,
            p_client: input.client_id,
            p_device: input.device_id,
            p_reason: input.reason,
          },
          user.tokens.access_token,
        );
      },
    );
    app.post<{
      Params: { id: string };
      Body: {
        request_id: string;
        device_id: string;
        starts_on: string;
        ends_on: string;
        share_price: string;
      };
    }>(
      '/api/admin/groups/:id/cycles',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          body: adminNewCycleBody,
          response: { 200: adminResultSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply),
          b = request.body;
        return configured().backend.rpc(
          'admin_start_cycle',
          {
            p_org: request.params.id,
            p_request: b.request_id,
            p_device: b.device_id,
            p_starts: b.starts_on,
            p_ends: b.ends_on,
            p_price: b.share_price,
          },
          user.tokens.access_token,
        );
      },
    );
    app.get<{ Params: { id: string } }>(
      '/api/groups/:id/reviews',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          response: { 200: reviewWorkspaceSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        return configured().backend.rpc(
          'review_workspace',
          { p_org: request.params.id },
          user.tokens.access_token,
        );
      },
    );
    app.post<{
      Params: { id: string };
      Body: {
        request_id: string;
        device_id: string;
        action: string;
        kind: string | null;
        source_type: string | null;
        source_id: string | null;
        review_id: string | null;
        proposal_id: string | null;
        outcome: string | null;
        reason: string;
      };
    }>(
      '/api/groups/:id/reviews',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          body: reviewCommandBody,
          response: { 200: adminResultSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply),
          b = request.body;
        return configured().backend.rpc(
          'review_command',
          {
            p_org: request.params.id,
            p_request: b.request_id,
            p_device: b.device_id,
            p_action: b.action,
            p_kind: b.kind,
            p_source_type: b.source_type,
            p_source: b.source_id,
            p_review: b.review_id,
            p_proposal: b.proposal_id,
            p_outcome: b.outcome,
            p_reason: b.reason,
          },
          user.tokens.access_token,
        );
      },
    );
    app.get<{ Params: { id: string } }>(
      '/api/groups/:id/shareout',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          response: { 200: finalShareoutSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        return checkedFinalShareout(
          await configured().backend.rpc(
            'shareout_workspace',
            { p_org: request.params.id },
            user.tokens.access_token,
          ),
        );
      },
    );
    app.post<{
      Params: { id: string };
      Body: {
        request_id: string;
        device_id: string;
        action: string;
        plan_id: string | null;
        allocation_id: string | null;
        reason: string;
        confirmed: boolean;
      };
    }>(
      '/api/groups/:id/shareout',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          body: finalShareoutBody,
          response: { 200: adminResultSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply),
          b = request.body;
        return configured().backend.rpc(
          'shareout_command',
          {
            p_org: request.params.id,
            p_action: b.action,
            p_request: b.request_id,
            p_device: b.device_id,
            p_plan: b.plan_id,
            p_allocation: b.allocation_id,
            p_reason: b.reason,
            p_confirm: b.confirmed,
          },
          user.tokens.access_token,
        );
      },
    );
    app.get<{ Params: { id: string } }>(
      '/api/groups/:id/shareout-preview',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          response: { 200: shareoutSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        return checkedShareOut(
          await configured().backend.rpc(
            'group_shareout_preview',
            { p_org: request.params.id },
            user.tokens.access_token,
          ),
        );
      },
    );
    app.get<{ Params: { id: string } }>(
      '/api/groups/:id/meetings',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          response: { 200: meetingWorkspaceSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        const backend = configured().backend;
        const raw = await backend.rpc(
          'meeting_workspace',
          { p_org: request.params.id },
          user.tokens.access_token,
        );
        return checkedMeetings(raw);
      },
    );
    app.post<{
      Params: { id: string };
      Body: {
        request_id: string;
        device_id: string;
        action: string;
        date: string | null;
        meeting_id: string | null;
        member_id: string | null;
        status: string | null;
        counted_cash: string | null;
        explanation: string | null;
        proposal_id: string | null;
      };
    }>(
      '/api/groups/:id/meetings',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          body: meetingCommandBody,
          response: { 200: adminResultSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        const b = request.body;
        return configured().backend.rpc(
          'meeting_command',
          {
            p_org: request.params.id,
            p_action: b.action,
            p_request: b.request_id,
            p_device: b.device_id,
            p_date: b.date,
            p_meeting: b.meeting_id,
            p_member: b.member_id,
            p_status: b.status,
            p_counted: b.counted_cash,
            p_explanation: b.explanation,
            p_proposal: b.proposal_id,
          },
          user.tokens.access_token,
        );
      },
    );
    app.get<{ Params: { id: string } }>(
      '/api/groups/:id/social',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          response: { 200: socialWorkspaceSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        return checkedSocial(
          await configured().backend.rpc(
            'social_workspace',
            { p_org: request.params.id },
            user.tokens.access_token,
          ),
        );
      },
    );
    app.post<{
      Params: { id: string };
      Body: {
        request_id: string;
        device_id: string;
        action: string;
        meeting_id: string | null;
        member_id: string | null;
        target_id: string | null;
        amount: string | null;
        reason: string;
      };
    }>(
      '/api/groups/:id/social',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          body: socialCommandBody,
          response: { 200: adminResultSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        const b = request.body;
        return configured().backend.rpc(
          'social_command',
          {
            p_org: request.params.id,
            p_action: b.action,
            p_request: b.request_id,
            p_device: b.device_id,
            p_meeting: b.meeting_id,
            p_member: b.member_id,
            p_amount: b.amount,
            p_reason: b.reason,
            p_target: b.target_id,
          },
          user.tokens.access_token,
        );
      },
    );
    app.post<{
      Params: { id: string };
      Body: {
        request_id: string;
        device_id: string;
        amount: string | null;
        roles: string[];
        separate: boolean;
        require_all: boolean;
      };
    }>(
      '/api/admin/groups/:id/social',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          body: socialRuleBody,
          response: { 200: adminResultSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await administrator(request, reply);
        const b = request.body;
        return configured().backend.rpc(
          'admin_social_rule',
          {
            p_org: request.params.id,
            p_request: b.request_id,
            p_device: b.device_id,
            p_amount: b.amount,
            p_roles: b.roles,
            p_separate: b.separate,
            p_require_all: b.require_all,
          },
          user.tokens.access_token,
        );
      },
    );
    app.get<{ Params: { id: string } }>(
      '/api/groups/:id/fines',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          response: { 200: fineWorkspaceSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        return checkedFines(
          await configured().backend.rpc(
            'fine_workspace',
            { p_org: request.params.id },
            user.tokens.access_token,
          ),
        );
      },
    );
    app.post<{
      Params: { id: string };
      Body: {
        request_id: string;
        device_id: string;
        action: string;
        meeting_id: string;
        member_id: string | null;
        target_id: string | null;
        code: string | null;
        amount: string | null;
        reason: string;
      };
    }>(
      '/api/groups/:id/fines',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          body: fineCommandBody,
          response: { 200: adminResultSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        const b = request.body;
        return configured().backend.rpc(
          'fine_command',
          {
            p_org: request.params.id,
            p_request: b.request_id,
            p_device: b.device_id,
            p_action: b.action,
            p_meeting: b.meeting_id,
            p_member: b.member_id,
            p_code: b.code,
            p_amount: b.amount,
            p_reason: b.reason,
            p_target: b.target_id,
          },
          user.tokens.access_token,
        );
      },
    );
    app.post<{
      Params: { id: string };
      Body: {
        request_id: string;
        device_id: string;
        rules: {
          code: string;
          name: string;
          amount: string;
          trigger: string;
          partial: boolean;
        }[];
      };
    }>(
      '/api/admin/groups/:id/fines',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          body: finePolicyBody,
          response: { 200: adminResultSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await administrator(request, reply);
        const b = request.body;
        return configured().backend.rpc(
          'admin_fine_policy',
          {
            p_org: request.params.id,
            p_request: b.request_id,
            p_device: b.device_id,
            p_rules: b.rules,
          },
          user.tokens.access_token,
        );
      },
    );
    app.get<{ Params: { id: string } }>(
      '/api/groups/:id/loans',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          response: { 200: loanWorkspaceSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        return checkedLoans(
          await configured().backend.rpc(
            'loan_workspace',
            { p_org: request.params.id },
            user.tokens.access_token,
          ),
        );
      },
    );
    app.post<{
      Params: { id: string };
      Body: {
        member_id: string;
        meeting_id: string;
        principal: string;
        months: string;
      };
    }>(
      '/api/groups/:id/loans/quote',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          body: loanQuoteBody,
          response: { 200: loanQuoteSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        const b = request.body;
        return checkedLoanQuote(
          await configured().backend.rpc(
            'loan_quote',
            {
              p_org: request.params.id,
              p_member: b.member_id,
              p_meeting: b.meeting_id,
              p_principal: b.principal,
              p_months: b.months,
            },
            user.tokens.access_token,
          ),
        );
      },
    );
    app.post<{
      Params: { id: string };
      Body: {
        request_id: string;
        device_id: string;
        action: string;
        meeting_id: string;
        member_id: string | null;
        target_id: string | null;
        policy_id: string | null;
        amount: string | null;
        months: string | null;
        reason: string;
        calculation?: {
          calc_version: string;
          principal: string;
          interest: string;
        } | null;
      };
    }>(
      '/api/groups/:id/loans',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          body: loanCommandBody,
          response: { 200: adminResultSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await authorised(request, reply);
        const b = request.body;
        return configured().backend.rpc(
          'loan_command',
          {
            p_org: request.params.id,
            p_request: b.request_id,
            p_device: b.device_id,
            p_action: b.action,
            p_meeting: b.meeting_id,
            p_member: b.member_id,
            p_amount: b.amount,
            p_months: b.months,
            p_policy: b.policy_id,
            p_reason: b.reason,
            p_target: b.target_id,
            p_client: b.calculation ?? null,
          },
          user.tokens.access_token,
        );
      },
    );
    app.post<{
      Params: { id: string };
      Body: { request_id: string; device_id: string; policy: unknown };
    }>(
      '/api/admin/groups/:id/loans',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', format: 'uuid' } },
          },
          body: loanPolicyBody,
          response: { 200: adminResultSchema, ...errors },
        },
      },
      async (request, reply) => {
        const user = await administrator(request, reply);
        const b = request.body;
        return configured().backend.rpc(
          'admin_loan_policy',
          {
            p_org: request.params.id,
            p_request: b.request_id,
            p_device: b.device_id,
            p_policy: b.policy,
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
    app.get(
      '/api/admin/workspace',
      { schema: { response: { 200: adminWorkspaceSchema, ...errors } } },
      async (request, reply) => {
        const user = await administrator(request, reply);
        return configured().backend.rpc(
          'admin_workspace',
          {},
          user.tokens.access_token,
        );
      },
    );
    interface Command {
      request_id: string;
      device_id: string;
    }
    interface GroupConfiguration {
      name: string;
      max_shares: string;
      starts_on: string;
      ends_on: string;
      share_price: string;
    }
    const groupParams = {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'string', format: 'uuid' } },
    };
    const adminResponses = { 200: adminResultSchema, ...errors };
    const commandArgs = (body: Command) => ({
      p_request: body.request_id,
      p_device: body.device_id,
    });
    const configurationArgs = (body: GroupConfiguration) => ({
      p_name: body.name,
      p_max: body.max_shares,
      p_starts: body.starts_on,
      p_ends: body.ends_on,
      p_price: body.share_price,
    });
    app.post<{
      Body: Command &
        GroupConfiguration & {
          country_code: string;
          currency: string;
          time_zone: string;
        };
    }>(
      '/api/admin/groups',
      {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: { body: adminGroupBody, response: adminResponses },
      },
      async (request, reply) => {
        const user = await administrator(request, reply);
        const body = request.body;
        return configured().backend.rpc(
          'admin_create_group',
          {
            ...commandArgs(body),
            ...configurationArgs(body),
            p_country: body.country_code,
            p_currency: body.currency,
            p_zone: body.time_zone,
          },
          user.tokens.access_token,
        );
      },
    );
    app.post<{ Params: { id: string }; Body: Command & GroupConfiguration }>(
      '/api/admin/groups/:id/settings',
      {
        schema: {
          params: groupParams,
          body: adminConfigurationBody,
          response: adminResponses,
        },
      },
      async (request, reply) => {
        const user = await administrator(request, reply);
        return configured().backend.rpc(
          'admin_configure_group',
          {
            ...commandArgs(request.body),
            ...configurationArgs(request.body),
            p_org: request.params.id,
          },
          user.tokens.access_token,
        );
      },
    );
    app.post<{
      Params: { id: string };
      Body: Command & {
        existing_person: string | null;
        name: string;
        phone: string | null;
      };
    }>(
      '/api/admin/groups/:id/members',
      {
        schema: {
          params: groupParams,
          body: adminMemberBody,
          response: adminResponses,
        },
      },
      async (request, reply) => {
        const user = await administrator(request, reply);
        const body = request.body;
        return configured().backend.rpc(
          'admin_add_member',
          {
            ...commandArgs(body),
            p_org: request.params.id,
            p_existing: body.existing_person,
            p_name: body.name,
            p_phone: body.phone,
          },
          user.tokens.access_token,
        );
      },
    );
    app.post<{
      Params: { id: string };
      Body: Command & { person_id: string; role: string; enabled: boolean };
    }>(
      '/api/admin/groups/:id/roles',
      {
        schema: {
          params: groupParams,
          body: adminRoleBody,
          response: adminResponses,
        },
      },
      async (request, reply) => {
        const user = await administrator(request, reply);
        const body = request.body;
        return configured().backend.rpc(
          'admin_set_role',
          {
            ...commandArgs(body),
            p_org: request.params.id,
            p_person: body.person_id,
            p_role: body.role,
            p_enabled: body.enabled,
          },
          user.tokens.access_token,
        );
      },
    );
  });
  return app;
}
