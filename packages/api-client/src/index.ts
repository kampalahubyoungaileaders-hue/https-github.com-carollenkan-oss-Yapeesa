import { v7 } from 'uuid';
import type { paths } from './schema';
export type Session =
  paths['/api/session']['get']['responses'][200]['content']['application/json'];
export type GroupList =
  paths['/api/groups']['get']['responses'][200]['content']['application/json'];
export type SavedWorkspace =
  paths['/api/groups/{id}']['get']['responses'][200]['content']['application/json'];
export type SharePurchase =
  paths['/api/groups/{id}/shares']['post']['requestBody']['content']['application/json'];
export type Receipt =
  paths['/api/groups/{id}/shares']['post']['responses'][200]['content']['application/json'];
export type Factor =
  paths['/api/auth/mfa/enroll']['post']['responses'][200]['content']['application/json'];
export type AdminWorkspace =
  paths['/api/admin/workspace']['get']['responses'][200]['content']['application/json'];
export type AdminGroupInput =
  paths['/api/admin/groups']['post']['requestBody']['content']['application/json'];
export type AdminSettingsInput =
  paths['/api/admin/groups/{id}/settings']['post']['requestBody']['content']['application/json'];
export type AdminMemberInput =
  paths['/api/admin/groups/{id}/members']['post']['requestBody']['content']['application/json'];
export type AdminRoleInput =
  paths['/api/admin/groups/{id}/roles']['post']['requestBody']['content']['application/json'];
export class ClientError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
async function request<T>(url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // Allow a sleeping host to start. Never retry a financial/auth mutation
      // automatically: the first request may already have been processed.
      signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw new ClientError(0, 'NETWORK_ERROR');
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    // A starting host can return an HTML loading page instead of API JSON.
    throw new ClientError(503, 'BACKEND_UNAVAILABLE');
  }
  if (!response.ok) {
    const code =
      value &&
      typeof value === 'object' &&
      'error' in value &&
      typeof value.error === 'string'
        ? value.error
        : 'REQUEST_FAILED';
    throw new ClientError(response.status, code);
  }
  return value as T;
}
export const api = {
  statement: async (id: string, memberId?: string): Promise<Blob> => {
    let response: Response;
    try {
      response = await fetch(
        `/api/groups/${encodeURIComponent(id)}/statement.pdf${memberId ? `?member_id=${encodeURIComponent(memberId)}` : ''}`,
        { credentials: 'same-origin', signal: AbortSignal.timeout(90000) },
      );
    } catch {
      throw new ClientError(0, 'NETWORK_ERROR');
    }
    if (!response.ok) {
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new ClientError(503, 'BACKEND_UNAVAILABLE');
      }
      throw new ClientError(
        response.status,
        value &&
          typeof value === 'object' &&
          'error' in value &&
          typeof value.error === 'string'
          ? value.error
          : 'REQUEST_FAILED',
      );
    }
    if (!response.headers.get('Content-Type')?.startsWith('application/pdf'))
      throw new ClientError(503, 'BACKEND_UNAVAILABLE');
    return response.blob();
  },
  adminWorkspace: () => request<AdminWorkspace>('/api/admin/workspace'),
  adminCreateGroup: (input: AdminGroupInput) =>
    request<{ id: string }>('/api/admin/groups', input),
  adminSettings: (id: string, input: AdminSettingsInput) =>
    request<{ id: string }>(
      `/api/admin/groups/${encodeURIComponent(id)}/settings`,
      input,
    ),
  adminAddMember: (id: string, input: AdminMemberInput) =>
    request<{ id: string }>(
      `/api/admin/groups/${encodeURIComponent(id)}/members`,
      input,
    ),
  adminRole: (id: string, input: AdminRoleInput) =>
    request<{ id: string }>(
      `/api/admin/groups/${encodeURIComponent(id)}/roles`,
      input,
    ),
  session: () => request<Session>('/api/session'),
  login: (phone: string, pin: string) =>
    request<Session>('/api/auth/login', { phone, pin }),
  requestInvitationCode: (phone: string) =>
    request<{ ok: boolean }>('/api/auth/invitation/code', { phone }),
  acceptInvitation: (phone: string, code: string, pin: string) =>
    request<Session>('/api/auth/invitation/accept', { phone, code, pin }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', {}),
  enroll: () => request<Factor>('/api/auth/mfa/enroll', {}),
  verify: (factor_id: string, code: string) =>
    request<Session>('/api/auth/mfa/verify', { factor_id, code }),
  groups: () => request<GroupList>('/api/groups'),
  workspace: (id: string) =>
    request<SavedWorkspace>(`/api/groups/${encodeURIComponent(id)}`),
  recordShares: (id: string, input: SharePurchase) =>
    request<Receipt>(`/api/groups/${encodeURIComponent(id)}/shares`, input),
};
export function newTransactionId(): string {
  return v7();
}
