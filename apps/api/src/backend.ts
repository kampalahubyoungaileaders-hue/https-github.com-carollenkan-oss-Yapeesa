import type { ApiConfig } from './config.js';
import type { Tokens } from './security.js';
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields?: string[],
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
      if (path.startsWith('/rest/v1/rpc/sacco_')) {
        if (code === '42501') throw new ApiError(403, 'PERMISSION_DENIED');
        if (code === '23505')
          throw new ApiError(409, 'SACCO_REFERENCE_CONFLICT');
        if (
          ['22023', '23514', '23502', '23503', 'P0001', 'P0002'].includes(code)
        )
          throw new ApiError(422, 'INVALID_SACCO_REQUEST');
      }
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
      if (
        ['/rest/v1/rpc/fine_command', '/rest/v1/rpc/fine_workspace'].includes(
          path,
        ) &&
        ['22023', '23514', 'P0001', 'P0002', '22003', '23503'].includes(code)
      )
        throw new ApiError(422, 'INVALID_FINE_REQUEST');
      if (
        [
          '/rest/v1/rpc/loan_command',
          '/rest/v1/rpc/loan_workspace',
          '/rest/v1/rpc/loan_quote',
        ].includes(path) &&
        ['22023', '23514', 'P0001', 'P0002', '22003', '23503'].includes(code)
      )
        throw new ApiError(422, 'INVALID_LOAN_REQUEST');
      if (
        [
          '/rest/v1/rpc/shareout_command',
          '/rest/v1/rpc/shareout_workspace',
        ].includes(path) &&
        ['22023', '23514', 'P0001', 'P0002', '22003', '23503'].includes(code)
      )
        throw new ApiError(422, 'SHAREOUT_UNAVAILABLE');
      if (
        [
          '/rest/v1/rpc/review_command',
          '/rest/v1/rpc/review_workspace',
        ].includes(path) &&
        ['22023', '23514', 'P0001', 'P0002', '22003', '23503'].includes(code)
      )
        throw new ApiError(422, 'INVALID_REVIEW_REQUEST');
      if (
        (path.startsWith('/rest/v1/rpc/staff_') ||
          path.startsWith('/rest/v1/rpc/mfa_')) &&
        ['22023', '23514', 'P0001', 'P0002', '22003', '23503'].includes(code)
      )
        throw new ApiError(422, 'INVALID_STAFF_REQUEST');
      if (path === '/rest/v1/rpc/group_audit_extract' && code === '54000')
        throw new ApiError(422, 'AUDIT_TOO_LARGE');
      if (
        path === '/rest/v1/rpc/group_audit_extract' &&
        ['22023', '23514', 'P0001', 'P0002'].includes(code)
      )
        throw new ApiError(422, 'AUDIT_UNAVAILABLE');
      if (path === '/rest/v1/rpc/programme_report' && code === '54000')
        throw new ApiError(422, 'PROGRAMME_TOO_LARGE');
      if (
        path === '/rest/v1/rpc/programme_report' &&
        ['22023', '22007', '22008'].includes(code)
      )
        throw new ApiError(422, 'INVALID_PROGRAMME_REPORT');
      if (code === '23505') throw new ApiError(409, 'DUPLICATE_REFERENCE');
      if (code === '42501') throw new ApiError(403, 'PERMISSION_DENIED');
      if (
        [
          '/rest/v1/rpc/social_command',
          '/rest/v1/rpc/social_workspace',
        ].includes(path) &&
        ['22023', '23514', 'P0001', 'P0002', '22003', '23503'].includes(code)
      )
        throw new ApiError(422, 'INVALID_SOCIAL_REQUEST');
      if (
        [
          '/rest/v1/rpc/meeting_command',
          '/rest/v1/rpc/meeting_workspace',
        ].includes(path) &&
        ['22023', '23514', 'P0001', 'P0002', '22003', '23503'].includes(code)
      )
        throw new ApiError(422, 'INVALID_MEETING_REQUEST');
      if (
        path === '/rest/v1/rpc/group_shareout_preview' &&
        ['22023', '23514', 'P0001', 'P0002', '22003'].includes(code)
      )
        throw new ApiError(422, 'SHAREOUT_UNAVAILABLE');
      if (
        path === '/rest/v1/rpc/reverse_share_purchase' &&
        ['22023', '23514', 'P0001', 'P0002', '22003'].includes(code)
      )
        throw new ApiError(422, 'INVALID_REVERSAL');
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
