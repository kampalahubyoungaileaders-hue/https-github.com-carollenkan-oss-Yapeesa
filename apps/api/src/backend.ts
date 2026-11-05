import type { ApiConfig } from './config.js';
import type { Tokens } from './security.js';
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
  return value as Record<string, unknown>;
}
export function textField(
  value: Record<string, unknown>,
  name: string,
): string {
  const result = value[name];
  if (typeof result !== 'string')
    throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
  return result;
}
export function tokensFrom(value: unknown): Tokens {
  const data = object(value);
  return {
    access_token: textField(data, 'access_token'),
    refresh_token: textField(data, 'refresh_token'),
  };
}
export class Backend {
  constructor(readonly config: ApiConfig) {}
  async request(
    path: string,
    method: string,
    body?: unknown,
    token?: string,
    gateway = false,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      apikey: this.config.publishableKey,
      'Content-Type': 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (gateway) headers['x-yapesa-auth'] = this.config.gatewayKey;
    let response: Response;
    try {
      response = await fetch(`${this.config.supabaseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new ApiError(503, 'BACKEND_UNAVAILABLE');
    }
    const raw = await response.text();
    let result: unknown;
    try {
      result = raw ? JSON.parse(raw) : null;
    } catch {
      throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
    }
    if (!response.ok) {
      const code =
        result &&
        typeof result === 'object' &&
        ('error_code' in result || 'code' in result)
          ? String('error_code' in result ? result.error_code : result.code)
          : '';
      if (path.startsWith('/auth/') && response.status === 429)
        throw new ApiError(429, 'TOO_MANY_ATTEMPTS');
      if (path === '/auth/v1/user' && code === 'same_password')
        throw new ApiError(409, 'PIN_UNCHANGED');
      if (path.startsWith('/auth/'))
        throw new ApiError(
          response.status >= 500 ? 503 : 401,
          response.status >= 500
            ? 'BACKEND_UNAVAILABLE'
            : 'INVALID_CREDENTIALS',
        );
      if (code === '23505') throw new ApiError(409, 'DUPLICATE_REFERENCE');
      if (code === '42501') throw new ApiError(403, 'PERMISSION_DENIED');
      if (
        path.startsWith('/rest/v1/rpc/admin_') &&
        [
          '22023',
          '23514',
          'P0001',
          'P0002',
          '22003',
          '22007',
          '22008',
        ].includes(code)
      )
        throw new ApiError(422, 'INVALID_ADMIN_REQUEST');
      if (['22023', '23514', 'P0001', 'P0002', '22003'].includes(code))
        throw new ApiError(422, 'INVALID_SHARE_PURCHASE');
      throw new ApiError(
        response.status >= 500 ? 503 : response.status,
        'BACKEND_REQUEST_FAILED',
      );
    }
    return result;
  }
  rpc(name: string, args: unknown, token?: string, gateway = false) {
    return this.request(`/rest/v1/rpc/${name}`, 'POST', args, token, gateway);
  }
  auth(path: string, body?: unknown, token?: string) {
    return this.request(
      `/auth/v1/${path}`,
      body === undefined ? 'GET' : 'POST',
      body,
      token,
    );
  }
}
