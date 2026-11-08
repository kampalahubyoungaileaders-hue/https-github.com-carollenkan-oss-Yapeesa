import { Backend, ApiError, object, textField } from './backend.js';
import { createStaffAdminHandler } from '../../../supabase/functions/staff-admin/handler.js';
export async function runStaffJob(
  backend: Backend,
  token: string,
  id: string,
  phase: 'invite' | 'activate',
) {
  const prepared = object(
    await backend.rpc(
      'staff_job',
      { p_invitation: id, p_phase: phase, p_finish: false, p_auth: null },
      token,
      true,
    ),
  );
  if (prepared['done'] === true) return { id };
  const input = { invitation_id: id, phase };
  let result: unknown;
  if (backend.config.authAdminKey) {
    const handler = createStaffAdminHandler({
      url: backend.config.supabaseUrl,
      publishableKey: backend.config.publishableKey,
      adminKey: backend.config.authAdminKey,
    });
    const r = await handler(
      new Request('https://internal.invalid/staff-admin', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      }),
    );
    if (!r.ok) throw new ApiError(503, 'AUTH_JOB_INCOMPLETE');
    result = await r.json();
  } else
    result = await backend.request(
      '/functions/v1/staff-admin',
      'POST',
      input,
      token,
    );
  const data = object(result);
  if (data['id'] !== id) throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
  await backend.rpc(
    'staff_job',
    {
      p_invitation: id,
      p_phase: phase,
      p_finish: true,
      p_auth: textField(data, 'auth_user_id'),
    },
    token,
    true,
  );
  return { id };
}
export async function activateInvitations(backend: Backend, token: string) {
  const raw = await backend.rpc('staff_pending_activation', {}, token);
  if (
    !Array.isArray(raw) ||
    raw.some((id) => typeof id !== 'string') ||
    raw.length > 20
  )
    throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
  for (const id of raw as string[])
    await runStaffJob(backend, token, id, 'activate');
}
