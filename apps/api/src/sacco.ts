import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { ApiError, Backend, object, textField } from './backend.js';
import type { ApiConfig } from './config.js';
import {
  Fineract,
  fineractJson,
  type FineractCredentials,
} from './fineract.js';
import { openFineract, sealFineract } from './sacco-credentials.js';
import { saccoDividendRecord } from './sacco-dividends.js';
import {
  saccoOperations,
  saccoResources,
  saccoPayload,
} from './sacco-catalog.js';
import {
  independentOperations,
  independentCommand,
  independentFingerprint,
} from './sacco-approval.js';
interface StaffIdentity {
  tokens: { access_token: string };
  context: { person_id: string; can_administer: boolean };
}
type Authorise = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<StaffIdentity>;
const uuid = { type: 'string', format: 'uuid' } as const;
const string = { type: 'string', maxLength: 500 } as const;
const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: { type: 'string' },
    fields: { type: 'array', items: { type: 'string' } },
  },
} as const;
const nativeSchema = {
  type: ['object', 'array', 'string', 'null', 'boolean'],
  additionalProperties: true,
} as const;
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: 'object', additionalProperties: false, properties, required });
const id = (value: unknown) => {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value))
    throw new ApiError(400, 'INVALID_SACCO_REFERENCE');
  return value;
};
const asArray = (v: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(v)) throw new ApiError(502, 'INVALID_FINERACT_RESPONSE');
  return v.map(object);
};
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
export function registerSacco(
  app: FastifyInstance,
  config: ApiConfig | undefined,
  authorise: Authorise,
) {
  const backend = config ? new Backend(config) : undefined;
  const rpc = (name: string, args: unknown, user: StaffIdentity) => {
    if (!backend) throw new ApiError(503, 'AUTH_NOT_CONFIGURED');
    return backend.rpc(name, args, user.tokens.access_token, true);
  };
  const errors = {
    400: errorSchema,
    401: errorSchema,
    403: errorSchema,
    409: errorSchema,
    422: errorSchema,
    502: errorSchema,
    503: errorSchema,
  };
  async function context(user: StaffIdentity, org: string) {
    const c = object(await rpc('sacco_context', { p_org: org }, user));
    if (
      c['person_id'] !== user.context.person_id ||
      !Array.isArray(c['roles']) ||
      !c['roles'].every((r) => typeof r === 'string')
    )
      throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
    const instance = textField(c, 'instance_key'),
      tenant = textField(c, 'tenant_id'),
      version = textField(c, 'version');
    const endpoint = config?.fineractInstances?.[instance];
    if (
      endpoint &&
      createHash('sha256').update(new URL(endpoint.url).href).digest('hex') !==
        c['endpoint_hash']
    )
      throw new ApiError(409, 'FINERACT_CONNECTION_CHANGED');
    return { raw: c, roles: c['roles'] as string[], tenant, version, endpoint };
  }
  async function staff(user: StaffIdentity, org: string) {
    const c = await context(user, org);
    if (!config || !c.endpoint)
      throw new ApiError(503, 'FINERACT_NOT_CONFIGURED');
    if (!c.raw['link']) throw new ApiError(403, 'FINERACT_RELINK_REQUIRED');
    const link = object(c.raw['link']),
      userId = id(textField(link, 'user_id'));
    const credentials = openFineract(
      textField(link, 'credential'),
      config.cookieKey,
      user.context.person_id,
      org,
      c.version,
      userId,
    );
    const client = new Fineract(c.endpoint, c.tenant, credentials);
    const auth = object(
      await client.request('POST', 'authentication', credentials),
    );
    if (
      auth['authenticated'] !== true ||
      auth['userId'] !== userId ||
      auth['username'] !== credentials.username ||
      !Array.isArray(auth['permissions']) ||
      !auth['permissions'].every((p) => typeof p === 'string') ||
      (auth['permissions'] as string[]).includes('ALL_FUNCTIONS')
    )
      throw new ApiError(403, 'FINERACT_INDIVIDUAL_STAFF_REQUIRED');
    return {
      ...c,
      client,
      userId,
      credentials,
      permissions: auth['permissions'] as string[],
    };
  }
  async function approvalQueue(
    user: StaffIdentity,
    org: string,
    c: Awaited<ReturnType<typeof staff>>,
  ) {
    const scope = c.roles.includes('manager')
      ? asArray(await rpc('sacco_approval_scope', { p_org: org }, user))
      : [];
    const local = asArray(
      await rpc(
        'sacco_review',
        { p_org: org, p_action: 'list', p_id: null, p_user: c.userId },
        user,
      ),
    );
    const raw = c.roles.includes('manager')
      ? asArray(await c.client.request('GET', 'makercheckers?includeJson=true'))
      : [];
    return [
      ...local,
      ...raw.flatMap((item) => {
        const bound = scope.find((s) => s['command_id'] === item['id']);
        if (!bound) return [];
        const body =
          typeof item['commandAsJson'] === 'string'
            ? fineractJson(item['commandAsJson'])
            : null;
        const hash = createHash('sha256').update(canonical(body)).digest('hex');
        if (!body || hash !== bound['body_hash']) return [];
        return [
          {
            id: item['id'],
            name: bound['actor_name'],
            operation: bound['operation'],
            status: item['processingResult'],
            date: item['madeOnDate'],
            review_hash: hash,
            values: body,
            can_check:
              bound['fineract_user_id'] !== c.userId &&
              bound['actor_id'] !== user.context.person_id,
          },
        ];
      }),
    ];
  }
  app.get(
    '/api/saccos',
    {
      schema: {
        response: {
          200: {
            type: 'array',
            items: obj({
              id: uuid,
              name: string,
              currency: string,
              time_zone: string,
              instance_key: string,
              tenant_id: string,
              can_work: { type: 'boolean' },
            }),
          },
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const user = await authorise(request, reply);
      return rpc('sacco_list', {}, user);
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/saccos/:id',
    {
      schema: {
        params: obj({ id: uuid }),
        response: {
          200: obj({
            configured: { type: 'boolean' },
            linked: { type: 'boolean' },
            roles: { type: 'array', items: string },
            username: { type: ['string', 'null'] },
            expected_username: { type: ['string', 'null'] },
          }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const user = await authorise(request, reply),
        c = await context(user, request.params.id);
      return {
        configured: !!c.endpoint,
        linked: !!c.raw['link'],
        roles: c.roles,
        expected_username: c.raw['expected_identity']
          ? textField(object(c.raw['expected_identity']), 'username')
          : null,
        username: c.raw['link']
          ? textField(object(c.raw['link']), 'username')
          : null,
      };
    },
  );
  app.post<{
    Params: { id: string };
    Body: { username: string; password: string; device_id: string };
  }>(
    '/api/saccos/:id/connect',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        params: obj({ id: uuid }),
        body: obj({
          username: { type: 'string', minLength: 1, maxLength: 100 },
          password: { type: 'string', minLength: 1, maxLength: 200 },
          device_id: uuid,
        }),
        response: { 200: obj({ id: uuid }), ...errors },
      },
    },
    async (request, reply) => {
      const user = await authorise(request, reply),
        org = request.params.id,
        c = await context(user, org);
      if (!config || !c.endpoint)
        throw new ApiError(503, 'FINERACT_NOT_CONFIGURED');
      const assigned = c.raw['expected_identity']
        ? object(c.raw['expected_identity'])
        : null;
      if (!assigned || request.body.username !== assigned['username'])
        throw new ApiError(403, 'FINERACT_IDENTITY_NOT_ASSIGNED');
      const credentials: FineractCredentials = {
          username: request.body.username,
          password: request.body.password,
        },
        client = new Fineract(c.endpoint, c.tenant, credentials);
      const auth = object(
        await client.request('POST', 'authentication', credentials),
      );
      if (
        auth['authenticated'] !== true ||
        auth['username'] !== credentials.username ||
        auth['userId'] !== assigned['user_id'] ||
        !Array.isArray(auth['permissions']) ||
        auth['permissions'].includes('ALL_FUNCTIONS')
      )
        throw new ApiError(403, 'FINERACT_INDIVIDUAL_STAFF_REQUIRED');
      const userId = id(auth['userId']);
      return rpc(
        'sacco_link',
        {
          p_org: org,
          p_user: userId,
          p_username: credentials.username,
          p_credential: sealFineract(
            credentials,
            config.cookieKey,
            user.context.person_id,
            org,
            c.version,
            userId,
          ),
          p_version: c.version,
          p_device: request.body.device_id,
        },
        user,
      );
    },
  );
  app.post<{ Params: { id: string }; Body: { device_id: string } }>(
    '/api/saccos/:id/disconnect',
    {
      schema: {
        params: obj({ id: uuid }),
        body: obj({ device_id: uuid }),
        response: { 200: obj({ id: uuid }), ...errors },
      },
    },
    async (request, reply) =>
      rpc(
        'sacco_unlink',
        { p_org: request.params.id, p_device: request.body.device_id },
        await authorise(request, reply),
      ),
  );
  app.get<{ Params: { id: string } }>(
    '/api/saccos/:id/catalog',
    {
      schema: {
        params: obj({ id: uuid }),
        response: {
          200: { type: 'object', additionalProperties: true },
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const c = await staff(await authorise(request, reply), request.params.id);
      return {
        resources: Object.entries(saccoResources)
          .filter(([, r]) => r.roles.some((role) => c.roles.includes(role)))
          .map(([key, r]) => ({
            id: key,
            label: r.label,
            detail: !!r.detail,
            template: !!r.template,
            page: !!r.page,
          })),
        operations: saccoOperations
          .filter(
            (op) =>
              op.roles.some((role) => c.roles.includes(role)) &&
              (op.checker || c.permissions.includes(op.permission)),
          )
          .map(({ id, label, resource, fields, target, subTarget, quote }) => ({
            id,
            label,
            resource,
            fields,
            target,
            sub_target: subTarget ?? false,
            quote: quote ?? false,
          })),
      };
    },
  );
  app.get<{
    Params: { id: string; resource: string };
    Querystring: {
      record?: string;
      template?: string;
      offset?: string;
      client?: string;
      product?: string;
      search?: string;
      from?: string;
      to?: string;
      office?: string;
    };
  }>(
    '/api/saccos/:id/records/:resource',
    {
      schema: {
        params: obj({ id: uuid, resource: string }),
        querystring: obj(
          {
            record: string,
            template: { type: 'string', enum: ['true'] },
            offset: { type: 'string', pattern: '^(0|[1-9][0-9]{0,6})$' },
            client: string,
            product: string,
            search: { type: 'string', maxLength: 100 },
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
            office: string,
          },
          [],
        ),
        response: { 200: nativeSchema, ...errors },
      },
    },
    async (request, reply) => {
      const user = await authorise(request, reply),
        c = await staff(user, request.params.id),
        r = saccoResources[request.params.resource],
        q = request.query;
      if (!r || !r.roles.some((role) => c.roles.includes(role)))
        throw new ApiError(403, 'PERMISSION_DENIED');
      if (request.params.resource === 'approvals') {
        const queue = await approvalQueue(user, request.params.id, c);
        if (q.record) {
          const found = queue.find((item) => item.id === q.record);
          if (!found) throw new ApiError(404, 'SACCO_APPROVAL_NOT_AVAILABLE');
          return found;
        }
        return { pageItems: queue, totalFilteredRecords: String(queue.length) };
      }
      let path = q.template ? r.template : q.record ? r.detail : r.path;
      if (!path) throw new ApiError(400, 'INVALID_SACCO_OPERATION');
      if (request.params.resource === 'dividends') {
        if (!q.product) throw new ApiError(400, 'SACCO_PRODUCT_REQUIRED');
        if (q.record)
          return saccoDividendRecord(
            (path) => c.client.request('GET', path),
            q.product,
            q.record,
            q.offset ?? '0',
          );
        path = path.replace('{product}', id(q.product));
      }
      if (q.record) path = path.replace('{id}', id(q.record));
      const params = new URLSearchParams();
      if (r.page && !q.record && !q.template) {
        params.set('limit', '50');
        params.set('offset', q.offset ?? '0');
      }
      if (q.client) params.set('clientId', id(q.client));
      if (q.product && request.params.resource !== 'dividends')
        params.set('productId', id(q.product));
      if (q.search && request.params.resource === 'members')
        params.set('displayName', q.search);
      if (request.params.resource === 'journals') {
        if (!q.from || !q.to || q.from > q.to || !q.office)
          throw new ApiError(400, 'SACCO_REPORT_PERIOD_REQUIRED');
        params.set('fromDate', q.from);
        params.set('toDate', q.to);
        params.set('officeId', id(q.office));
        params.set('dateFormat', 'yyyy-MM-dd');
        params.set('locale', 'en');
      }
      const suffix = params.toString();
      return c.client.request(
        'GET',
        path + (suffix ? (path.includes('?') ? '&' : '?') + suffix : ''),
      );
    },
  );
  app.post<{
    Params: { id: string };
    Body: {
      request_id: string;
      operation: string;
      record?: string;
      sub_record?: string;
      review_hash?: string;
      values: Record<string, string>;
    };
  }>(
    '/api/saccos/:id/commands',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: obj({ id: uuid }),
        body: obj(
          {
            request_id: uuid,
            operation: string,
            record: string,
            sub_record: string,
            review_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            values: {
              type: 'object',
              maxProperties: 60,
              additionalProperties: { type: 'string', maxLength: 500 },
            },
          },
          ['request_id', 'operation', 'values'],
        ),
        response: {
          200: { type: 'object', additionalProperties: true },
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const user = await authorise(request, reply),
        org = request.params.id,
        c = await staff(user, org),
        input = request.body,
        op = saccoOperations.find((v) => v.id === input.operation);
      if (
        !op ||
        !op.roles.some((role) => c.roles.includes(role)) ||
        (!op.checker && !c.permissions.includes(op.permission))
      )
        throw new ApiError(403, 'PERMISSION_DENIED');
      const localReview =
        op.checker && input.record && /^[0-9a-f-]{36}$/i.test(input.record);
      if (localReview) {
        const queue = await approvalQueue(user, org, c);
        const proposal = queue.find((row) => row.id === input.record);
        if (!proposal || proposal['review_hash'] !== input.review_hash)
          throw new ApiError(409, 'SACCO_REVIEW_CHANGED');
        const frozen = object(proposal['values']);
        const checked = independentCommand(frozen, c.roles, c.permissions);
        if (independentFingerprint(checked) !== frozen['command_hash'])
          throw new ApiError(409, 'SACCO_REVIEW_CHANGED');
        const args = {
          p_org: org,
          p_id: input.record,
          p_user: c.userId,
          p_hash: input.review_hash,
        };
        if (op.id === 'checker.approve' || op.id === 'checker.reject') {
          return rpc(
            'sacco_review',
            {
              ...args,
              p_action: 'decide',
              p_approved: op.id === 'checker.approve',
            },
            user,
          );
        }
        if (op.id !== 'approval.execute')
          throw new ApiError(400, 'INVALID_SACCO_OPERATION');
        if (!c.endpoint?.localTest && !config?.fineractGatewayOnly)
          throw new ApiError(503, 'FINERACT_PRIVATE_GATEWAY_REQUIRED');
        // Native controls must not be silently disabled by the gateway.
        const policies = asArray(
          await c.client.request('GET', 'permissions?makerCheckerable=true'),
        );
        if (
          !policies.some(
            (p) =>
              p['code'] === checked.operation.permission &&
              p['selected'] === false,
          )
        )
          throw new ApiError(409, 'FINERACT_APPROVAL_CONFIGURATION_CHANGED');
        const claim = object(
          await rpc('sacco_review', { ...args, p_action: 'claim' }, user),
        );
        if (claim['status'] !== 'claimed') return claim;
        // Execute exactly the proposal that the database returned after atomic claim.
        const command = independentCommand(
          object(claim['payload']),
          c.roles,
          c.permissions,
        );
        let status: string;
        let result: Record<string, string> = {};
        try {
          const response = object(
            await c.client.request(
              command.operation.method,
              command.path,
              command.body,
              input.record,
            ),
          );
          for (const [source, key] of [
            ['commandId', 'command_id'],
            ['resourceId', 'resource_id'],
            ['subResourceId', 'sub_resource_id'],
          ] as const)
            if (response[source] !== undefined && response[source] !== null)
              result[key] = id(response[source]);
          result['body_hash'] = createHash('sha256')
            .update(canonical(command.body))
            .digest('hex');
          status = 'succeeded';
        } catch (error) {
          status =
            error instanceof ApiError &&
            error.status < 500 &&
            error.status !== 409
              ? 'rejected'
              : 'uncertain';
          result = {
            error:
              error instanceof ApiError
                ? error.code
                : 'FINERACT_OUTCOME_UNCERTAIN',
          };
        }
        return rpc(
          'sacco_review',
          { ...args, p_action: 'finish', p_status: status, p_result: result },
          user,
        );
      }
      if (op.id === 'approval.execute')
        throw new ApiError(400, 'INVALID_SACCO_REFERENCE');
      if (independentOperations.has(op.id)) {
        const native = independentCommand(input, c.roles, c.permissions);
        return rpc(
          'sacco_review',
          {
            p_org: org,
            p_action: 'submit',
            p_id: input.request_id,
            p_user: c.userId,
            p_payload: {
              operation: input.operation,
              command_hash: independentFingerprint(native),
              values: input.values,
              ...(input.record ? { record: input.record } : {}),
              ...(input.sub_record ? { sub_record: input.sub_record } : {}),
            },
          },
          user,
        );
      }
      const body = saccoPayload(op, input.values);
      let path = op.path;
      if (op.target) path = path.replace('{id}', id(input.record));
      else if (input.record) throw new ApiError(400, 'INVALID_SACCO_REFERENCE');
      if (op.subTarget) path = path.replace('{subId}', id(input.sub_record));
      else if (input.sub_record)
        throw new ApiError(400, 'INVALID_SACCO_REFERENCE');
      if (op.quote)
        return {
          status: 'preview',
          data: await c.client.request(op.method, path, body),
        };
      const hash = createHash('sha256')
        .update(
          canonical({
            operation: op.id,
            path,
            body,
            review_hash: input.review_hash ?? null,
          }),
        )
        .digest('hex');
      const prior = object(
        await rpc(
          'sacco_prepare',
          {
            p_org: org,
            p_request: input.request_id,
            p_operation: op.id,
            p_hash: hash,
            p_user: c.userId,
          },
          user,
        ),
      );
      if (['succeeded', 'rejected'].includes(String(prior['status'])))
        return {
          id: input.request_id,
          status: prior['status'],
          result: prior['result'],
        };
      // Require Fineract's own independent checker for every mutating customer command.
      // Never quietly fall back to an immediate posting when controls are disabled.
      const settings = object(await c.client.request('GET', 'configurations'));
      if (
        !asArray(settings['globalConfiguration']).some(
          (s) => s['name'] === 'maker-checker' && s['enabled'] === true,
        )
      )
        throw new ApiError(409, 'FINERACT_APPROVAL_CONTROLS_REQUIRED');
      if (!op.checker) {
        const policies = asArray(
          await c.client.request('GET', 'permissions?makerCheckerable=true'),
        );
        if (
          !policies.some(
            (p) => p['code'] === op.permission && p['selected'] === true,
          )
        )
          throw new ApiError(409, 'FINERACT_APPROVAL_CONTROLS_REQUIRED');
      }
      if (op.checker) {
        const queue = await approvalQueue(user, org, c),
          item = queue.find((item) => item.id === input.record);
        if (!item || !item.can_check || item.review_hash !== input.review_hash)
          throw new ApiError(409, 'SACCO_REVIEW_CHANGED');
      }
      // The same stable key is reused only on an explicit retry of this exact command.
      // A timeout is never treated as proof that the transaction failed.
      try {
        const response = object(
          await c.client.request(op.method, path, body, input.request_id),
        );
        const result: Record<string, string> = {
          body_hash: createHash('sha256').update(canonical(body)).digest('hex'),
        };
        for (const [source, key] of [
          ['commandId', 'command_id'],
          ['resourceId', 'resource_id'],
          ['subResourceId', 'sub_resource_id'],
        ] as const) {
          const value = response[source];
          if (value !== undefined && value !== null) result[key] = id(value);
        }
        result['status'] =
          response['commandId'] && !response['resourceId']
            ? 'awaiting_checker'
            : 'recorded';
        return await rpc(
          'sacco_finish',
          {
            p_org: org,
            p_request: input.request_id,
            p_status: 'succeeded',
            p_result: result,
          },
          user,
        );
      } catch (error) {
        const uncertain =
          !(error instanceof ApiError) ||
          error.status >= 500 ||
          error.status === 409;
        try {
          await rpc(
            'sacco_finish',
            {
              p_org: org,
              p_request: input.request_id,
              p_status: uncertain ? 'uncertain' : 'rejected',
              p_result: {
                error:
                  error instanceof ApiError
                    ? error.code
                    : 'FINERACT_OUTCOME_UNCERTAIN',
              },
            },
            user,
          );
        } catch {
          /* Preserve the stable native key for reconciliation even if receipt persistence is unavailable. */
        }
        throw uncertain
          ? new ApiError(503, 'FINERACT_OUTCOME_UNCERTAIN')
          : error;
      }
    },
  );
  app.post<{
    Params: { id: string };
    Body: {
      request_id: string;
      device_id: string;
      person: string;
      user: string;
      username: string;
      reason: string;
    };
  }>(
    '/api/admin/saccos/:id/identities',
    {
      schema: {
        params: obj({ id: uuid }),
        body: obj({
          request_id: uuid,
          device_id: uuid,
          person: uuid,
          user: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
          username: { type: 'string', minLength: 1, maxLength: 100 },
          reason: { type: 'string', minLength: 1, maxLength: 500 },
        }),
        response: { 200: obj({ id: uuid }), ...errors },
      },
    },
    async (request, reply) => {
      const user = await authorise(request, reply);
      if (!user.context.can_administer)
        throw new ApiError(403, 'PERMISSION_DENIED');
      const b = request.body;
      return rpc(
        'sacco_assign_identity',
        {
          p_request: b.request_id,
          p_device: b.device_id,
          p_org: request.params.id,
          p_person: b.person,
          p_user: b.user,
          p_username: b.username,
          p_reason: b.reason,
        },
        user,
      );
    },
  );
  app.get(
    '/api/admin/saccos',
    {
      schema: {
        response: {
          200: { type: 'object', additionalProperties: true },
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const user = await authorise(request, reply);
      if (!user.context.can_administer)
        throw new ApiError(403, 'PERMISSION_DENIED');
      return {
        saccos: await rpc('sacco_list', {}, user),
        ...object(await rpc('sacco_administration', {}, user)),
        instances: Object.keys(config?.fineractInstances ?? {}),
      };
    },
  );
  app.post<{
    Body: {
      request_id: string;
      device_id: string;
      action: 'create' | 'role';
      org?: string;
      name?: string;
      country?: string;
      currency?: string;
      zone?: string;
      instance?: string;
      tenant?: string;
      person?: string;
      role?: string;
      enabled?: boolean;
      reason: string;
    };
  }>(
    '/api/admin/saccos',
    {
      schema: {
        body: obj(
          {
            request_id: uuid,
            device_id: uuid,
            action: { type: 'string', enum: ['create', 'role'] },
            org: uuid,
            name: string,
            country: string,
            currency: string,
            zone: string,
            instance: string,
            tenant: string,
            person: uuid,
            role: {
              type: 'string',
              enum: [
                'manager',
                'accountant',
                'loan_officer',
                'teller',
                'field_officer',
              ],
            },
            enabled: { type: 'boolean' },
            reason: { type: 'string', minLength: 1, maxLength: 500 },
          },
          ['request_id', 'device_id', 'action', 'reason'],
        ),
        response: { 200: obj({ id: uuid }), ...errors },
      },
    },
    async (request, reply) => {
      const user = await authorise(request, reply);
      if (!user.context.can_administer)
        throw new ApiError(403, 'PERMISSION_DENIED');
      const b = request.body;
      if (b.action === 'create') {
        const endpoint = config?.fineractInstances?.[b.instance ?? ''];
        if (!endpoint) throw new ApiError(503, 'FINERACT_NOT_CONFIGURED');
        new Fineract(endpoint, b.tenant ?? '', {
          username: 'configuration-check',
          password: 'configuration-check',
        });
      }
      return rpc(
        'sacco_admin',
        {
          p_request: b.request_id,
          p_device: b.device_id,
          p_action: b.action,
          p_org: b.org ?? null,
          p_name: b.name ?? null,
          p_country: b.country ?? null,
          p_currency: b.currency ?? null,
          p_zone: b.zone ?? null,
          p_instance: b.instance ?? null,
          p_tenant: b.tenant ?? null,
          p_person: b.person ?? null,
          p_role: b.role ?? null,
          p_enabled: b.enabled ?? null,
          p_reason: b.reason,
          p_endpoint_hash:
            b.action === 'create'
              ? createHash('sha256')
                  .update(
                    new URL(config!.fineractInstances![b.instance!]!.url).href,
                  )
                  .digest('hex')
              : null,
        },
        user,
      );
    },
  );
}
