import { v7 } from 'uuid';
import type { paths } from './schema';
export type Recovery =
  paths['/api/auth/recovery/verify']['post']['responses'][200]['content']['application/json'];
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
export type ShareReversal =
  paths['/api/groups/{id}/reversals']['post']['requestBody']['content']['application/json'];
export type FinalShareout =
  paths['/api/groups/{id}/shareout']['get']['responses'][200]['content']['application/json'];
export type FinalShareoutCommand =
  paths['/api/groups/{id}/shareout']['post']['requestBody']['content']['application/json'];
export type ShareOutPreview =
  paths['/api/groups/{id}/shareout-preview']['get']['responses'][200]['content']['application/json'];
export type Factor =
  paths['/api/auth/mfa/enroll']['post']['responses'][200]['content']['application/json'];
export type AdminWorkspace =
  paths['/api/admin/workspace']['get']['responses'][200]['content']['application/json'];
export type ReviewWorkspace =
  paths['/api/groups/{id}/reviews']['get']['responses'][200]['content']['application/json'];
export type ReviewCommand =
  paths['/api/groups/{id}/reviews']['post']['requestBody']['content']['application/json'];
export type RecoveryWorkspace =
  paths['/api/admin/authenticator-recovery']['get']['responses'][200]['content']['application/json'];
export type StaffWorkspace =
  paths['/api/admin/staff']['get']['responses'][200]['content']['application/json'];
export type StaffInviteInput =
  paths['/api/admin/staff/invitations']['post']['requestBody']['content']['application/json'];
export type AdminNewCycleInput =
  paths['/api/admin/groups/{id}/cycles']['post']['requestBody']['content']['application/json'];
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
export type LoanWorkspace =
  paths['/api/groups/{id}/loans']['get']['responses'][200]['content']['application/json'];
export type LoanCommand =
  paths['/api/groups/{id}/loans']['post']['requestBody']['content']['application/json'];
export type LoanPolicyInput =
  paths['/api/admin/groups/{id}/loans']['post']['requestBody']['content']['application/json'];
export type LoanQuoteInput =
  paths['/api/groups/{id}/loans/quote']['post']['requestBody']['content']['application/json'];
export type LoanQuote =
  paths['/api/groups/{id}/loans/quote']['post']['responses'][200]['content']['application/json'];
export type FineWorkspace =
  paths['/api/groups/{id}/fines']['get']['responses'][200]['content']['application/json'];
export type FineCommand =
  paths['/api/groups/{id}/fines']['post']['requestBody']['content']['application/json'];
export type FinePolicyInput =
  paths['/api/admin/groups/{id}/fines']['post']['requestBody']['content']['application/json'];
export type SocialWorkspace =
  paths['/api/groups/{id}/social']['get']['responses'][200]['content']['application/json'];
export type SocialCommand =
  paths['/api/groups/{id}/social']['post']['requestBody']['content']['application/json'];
export type SocialRuleInput =
  paths['/api/admin/groups/{id}/social']['post']['requestBody']['content']['application/json'];
export type MeetingWorkspace =
  paths['/api/groups/{id}/meetings']['get']['responses'][200]['content']['application/json'];
export type MeetingCommand =
  paths['/api/groups/{id}/meetings']['post']['requestBody']['content']['application/json'];
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
  loans: (id: string) =>
    request<LoanWorkspace>(`/api/groups/${encodeURIComponent(id)}/loans`),
  loanCommand: (id: string, input: LoanCommand) =>
    request<{ id: string }>(
      `/api/groups/${encodeURIComponent(id)}/loans`,
      input,
    ),
  loanPolicy: (id: string, input: LoanPolicyInput) =>
    request<{ id: string }>(
      `/api/admin/groups/${encodeURIComponent(id)}/loans`,
      input,
    ),
  loanQuote: (id: string, input: LoanQuoteInput) =>
    request<LoanQuote>(
      `/api/groups/${encodeURIComponent(id)}/loans/quote`,
      input,
    ),
  fines: (id: string) =>
    request<FineWorkspace>(`/api/groups/${encodeURIComponent(id)}/fines`),
  fineCommand: (id: string, input: FineCommand) =>
    request<{ id: string }>(
      `/api/groups/${encodeURIComponent(id)}/fines`,
      input,
    ),
  finePolicy: (id: string, input: FinePolicyInput) =>
    request<{ id: string }>(
      `/api/admin/groups/${encodeURIComponent(id)}/fines`,
      input,
    ),
  social: (id: string) =>
    request<SocialWorkspace>(`/api/groups/${encodeURIComponent(id)}/social`),
  socialCommand: (id: string, input: SocialCommand) =>
    request<{ id: string }>(
      `/api/groups/${encodeURIComponent(id)}/social`,
      input,
    ),
  socialRule: (id: string, input: SocialRuleInput) =>
    request<{ id: string }>(
      `/api/admin/groups/${encodeURIComponent(id)}/social`,
      input,
    ),
  meetings: (id: string) =>
    request<MeetingWorkspace>(`/api/groups/${encodeURIComponent(id)}/meetings`),
  meetingCommand: (id: string, input: MeetingCommand) =>
    request<{ id: string }>(
      `/api/groups/${encodeURIComponent(id)}/meetings`,
      input,
    ),
  recoveryCode: (phone: string) =>
    request<{ ok: boolean }>('/api/auth/recovery/code', { phone }),
  recoveryVerify: (phone: string, code: string) =>
    request<Recovery>('/api/auth/recovery/verify', { phone, code }),
  recoveryMfa: (factor_id: string, code: string) =>
    request<Recovery>('/api/auth/recovery/mfa', { factor_id, code }),
  recoveryComplete: (pin: string) =>
    request<{ ok: boolean; cleanup_complete: boolean }>(
      '/api/auth/recovery/complete',
      { pin },
    ),
  recoveryFinish: () =>
    request<{ ok: boolean; cleanup_complete: boolean }>(
      '/api/auth/recovery/finish',
      {},
    ),
  recoveryCancel: () =>
    request<{ ok: boolean }>('/api/auth/recovery/cancel', {}),
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
  reviews: (id: string) =>
    request<ReviewWorkspace>(`/api/groups/${encodeURIComponent(id)}/reviews`),
  reviewCommand: (id: string, input: ReviewCommand) =>
    request<{ id: string }>(
      `/api/groups/${encodeURIComponent(id)}/reviews`,
      input,
    ),
  recoveryRequest: (request_id: string, reason: string) =>
    request<{ id: string }>('/api/auth/recovery/lost-authenticator', {
      request_id,
      reason,
    }),
  recoveryEnroll: () => request<Factor>('/api/auth/recovery/enroll', {}),
  recoveryWorkspace: () =>
    request<RecoveryWorkspace>('/api/admin/authenticator-recovery'),
  recoveryApprove: (
    id: string,
    request_id: string,
    evidence: string,
    identity_verified: boolean,
  ) =>
    request<{ id: string }>(
      `/api/admin/authenticator-recovery/${encodeURIComponent(id)}/approve`,
      { request_id, evidence, identity_verified },
    ),
  recoveryReset: (id: string) =>
    request<{ id: string }>(
      `/api/admin/authenticator-recovery/${encodeURIComponent(id)}/reset`,
      {},
    ),
  staffWorkspace: () => request<StaffWorkspace>('/api/admin/staff'),
  staffInvite: (input: StaffInviteInput) =>
    request<{ id: string }>('/api/admin/staff/invitations', input),
  staffInviteRetry: (id: string) =>
    request<{ id: string }>(
      `/api/admin/staff/invitations/${encodeURIComponent(id)}/retry`,
      {},
    ),
  finishStaffActivation: () =>
    request<Session>('/api/auth/invitation/finish', {}),
  adminStartCycle: (id: string, input: AdminNewCycleInput) =>
    request<{ id: string }>(
      `/api/admin/groups/${encodeURIComponent(id)}/cycles`,
      input,
    ),
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
  finalShareout: (id: string) =>
    request<FinalShareout>(`/api/groups/${encodeURIComponent(id)}/shareout`),
  shareoutCommand: (id: string, input: FinalShareoutCommand) =>
    request<{ id: string }>(
      `/api/groups/${encodeURIComponent(id)}/shareout`,
      input,
    ),
  shareOutPreview: (id: string) =>
    request<ShareOutPreview>(
      `/api/groups/${encodeURIComponent(id)}/shareout-preview`,
    ),
  recordShares: (id: string, input: SharePurchase) =>
    request<Receipt>(`/api/groups/${encodeURIComponent(id)}/shares`, input),
  reverseShares: (id: string, input: ShareReversal) =>
    request<Receipt>(`/api/groups/${encodeURIComponent(id)}/reversals`, input),
};
export function newTransactionId(): string {
  return v7();
}
