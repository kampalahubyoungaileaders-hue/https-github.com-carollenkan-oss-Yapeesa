export interface StaffAdminConfig {
  url: string | undefined;
  publishableKey: string | undefined;
  adminKey: string | undefined;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid response');
  return value as Record<string, unknown>;
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function createStaffAdminHandler(
  config: StaffAdminConfig,
  fetcher: typeof fetch = fetch,
) {
  return async (request: Request): Promise<Response> => {
    const fail = (status: number, error: string) =>
      Response.json(
        { error },
        { status, headers: { 'Cache-Control': 'no-store' } },
      );
    if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED');
    if (!config.url || !config.publishableKey || !config.adminKey)
      return fail(503, 'AUTH_ADMIN_NOT_CONFIGURED');
    const auth = request.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ') || auth.length > 5000)
      return fail(401, 'AUTH_REQUIRED');
    let input: Record<string, unknown>;
    try {
      const raw = await request.text();
      if (raw.length > 1024) return fail(400, 'INVALID_REQUEST');
      input = object(JSON.parse(raw));
    } catch {
      return fail(400, 'INVALID_REQUEST');
    }
    if (
      Object.keys(input).some((k) => !['invitation_id', 'phase'].includes(k)) ||
      typeof input['invitation_id'] !== 'string' ||
      !uuid.test(input['invitation_id']) ||
      !['invite', 'activate'].includes(String(input['phase']))
    )
      return fail(400, 'INVALID_REQUEST');
    let job: Record<string, unknown>;
    try {
      const result = await fetcher(
        `${config.url}/rest/v1/rpc/staff_job_context`,
        {
          method: 'POST',
          headers: {
            apikey: config.publishableKey,
            Authorization: auth,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_invitation: input['invitation_id'],
            p_phase: input['phase'],
          }),
          signal: AbortSignal.timeout(12000),
        },
      );
      if (!result.ok)
        return fail(result.status >= 500 ? 503 : 403, 'JOB_NOT_AUTHORIZED');
      job = object(await result.json());
      if (
        job['id'] !== input['invitation_id'] ||
        job['phase'] !== input['phase'] ||
        typeof job['email'] !== 'string' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job['email']) ||
        typeof job['phone'] !== 'string' ||
        !/^\+[1-9][0-9]{6,14}$/.test(job['phone'])
      )
        return fail(502, 'INVALID_JOB');
    } catch {
      return fail(503, 'BACKEND_UNAVAILABLE');
    }
    if (job['done'] === true)
      return Response.json(
        { id: job['id'], auth_user_id: job['auth_user_id'] },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    try {
      const headers = {
        apikey: config.adminKey,
        Authorization: `Bearer ${config.adminKey}`,
        'Content-Type': 'application/json',
      };
      const call = async (path: string, method: string, body?: object) => {
        const r = await fetcher(`${config.url}/auth/v1${path}`, {
          method,
          headers,
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(12000),
        });
        if (!r.ok) throw new Error('Auth operation failed');
        return object(await r.json());
      };
      let id = job['auth_user_id'];
      if (id !== null && (typeof id !== 'string' || !uuid.test(id)))
        throw new Error('Invalid identity');
      if (job['phase'] === 'invite' && id === null) {
        // No chosen PIN or auto-confirmed identity. This API does not send an SMS.
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const password = Array.from(bytes, (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
        const result = await call('/admin/users', 'POST', {
          phone: job['phone'],
          phone_confirm: false,
          email: job['email'],
          email_confirm: false,
          password,
          app_metadata: {
            yapesa_activation: 'pending',
            yapesa_invitation_id: job['id'],
          },
        });
        const user = object(result['user'] ?? result);
        id = user['id'];
      }
      if (typeof id !== 'string' || !uuid.test(id))
        throw new Error('Auth identity required');
      if (job['phase'] === 'activate') {
        const result = await call(
          `/admin/users/${encodeURIComponent(id)}`,
          'GET',
        );
        const user = object(result['user'] ?? result),
          metadata = object(user['app_metadata']);
        if (
          metadata['yapesa_invitation_id'] !== job['id'] ||
          user['phone'] !== String(job['phone']).slice(1) ||
          !user['phone_confirmed_at']
        )
          throw new Error('Identity mismatch');
        await call(`/admin/users/${encodeURIComponent(id)}`, 'PUT', {
          app_metadata: { ...metadata, yapesa_activation: 'active' },
        });
      }
      return Response.json(
        { id: job['id'], auth_user_id: id },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch {
      return fail(503, 'AUTH_JOB_INCOMPLETE');
    }
  };
}
