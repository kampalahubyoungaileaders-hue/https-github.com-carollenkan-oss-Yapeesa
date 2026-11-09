export interface MfaResetConfig {
  url: string | undefined;
  publishableKey: string | undefined;
  adminKey: string | undefined;
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw Error('Invalid response');
  return v as Record<string, unknown>;
}
export function createMfaResetHandler(
  config: MfaResetConfig,
  fetcher: typeof fetch = fetch,
) {
  return async (request: Request): Promise<Response> => {
    const result = (status: number, body: object) =>
      Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    if (request.method !== 'POST')
      return result(405, { error: 'METHOD_NOT_ALLOWED' });
    if (!config.url || !config.publishableKey || !config.adminKey)
      return result(503, { error: 'AUTH_ADMIN_NOT_CONFIGURED' });
    const auth = request.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ') || auth.length > 5000)
      return result(401, { error: 'AUTH_REQUIRED' });
    let id: string;
    try {
      const raw = await request.text();
      if (raw.length > 256) throw Error();
      const input = object(JSON.parse(raw));
      if (
        Object.keys(input).length !== 1 ||
        typeof input['id'] !== 'string' ||
        !uuid.test(input['id'])
      )
        throw Error();
      id = input['id'];
    } catch {
      return result(400, { error: 'INVALID_REQUEST' });
    }
    try {
      const authorized = await fetcher(
        `${config.url}/rest/v1/rpc/mfa_reset_context`,
        {
          method: 'POST',
          headers: {
            apikey: config.publishableKey,
            Authorization: auth,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ p_case: id }),
          signal: AbortSignal.timeout(12000),
        },
      );
      if (!authorized.ok)
        return result(authorized.status >= 500 ? 503 : 403, {
          error: 'JOB_NOT_AUTHORIZED',
        });
      const job = object(await authorized.json());
      if (
        job['id'] !== id ||
        typeof job['auth_user_id'] !== 'string' ||
        !uuid.test(job['auth_user_id']) ||
        !Array.isArray(job['factor_ids']) ||
        !job['factor_ids'].length ||
        job['factor_ids'].some((f) => typeof f !== 'string' || !uuid.test(f))
      )
        return result(502, { error: 'INVALID_JOB' });
      if (job['done'] === true) return result(200, { id });
      const user = job['auth_user_id'];
      const original = job['factor_ids'] as string[];
      const headers = {
        apikey: config.adminKey,
        Authorization: `Bearer ${config.adminKey}`,
        'Content-Type': 'application/json',
      };
      const path = `${config.url}/auth/v1/admin/users/${encodeURIComponent(user)}/factors`;
      const listed = await fetcher(path, {
        headers,
        signal: AbortSignal.timeout(12000),
      });
      if (!listed.ok) throw Error('List failed');
      const raw: unknown = await listed.json();
      if (!Array.isArray(raw)) throw Error('Invalid factor list');
      const factors = raw.map(object);
      if (
        factors.some(
          (f) =>
            typeof f['id'] !== 'string' ||
            !original.includes(f['id']) ||
            f['factor_type'] !== 'totp',
        )
      )
        return result(409, { error: 'AUTHENTICATOR_CHANGED' });
      // Delete verified factors first: Supabase downgrades affected sessions to AAL1.
      // The database recovery lock also prevents old sessions from regaining authority.
      factors.sort(
        (a, b) =>
          Number(b['status'] === 'verified') -
          Number(a['status'] === 'verified'),
      );
      for (const f of factors) {
        const removed = await fetcher(
          `${path}/${encodeURIComponent(String(f['id']))}`,
          { method: 'DELETE', headers, signal: AbortSignal.timeout(12000) },
        );
        if (!removed.ok && removed.status !== 404) throw Error('Delete failed');
      }
      return result(200, { id });
    } catch {
      return result(503, { error: 'AUTH_JOB_INCOMPLETE' });
    }
  };
}
