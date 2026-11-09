import { Backend, ApiError, object } from './backend.js';
import { createMfaResetHandler } from '../../../supabase/functions/mfa-reset/handler.js';
export async function resetAuthenticator(
  backend: Backend,
  token: string,
  id: string,
) {
  const prepared = object(
    await backend.rpc(
      'mfa_reset_job',
      { p_case: id, p_finish: false },
      token,
      true,
    ),
  );
  if (prepared['done'] === true) return { id };
  if (backend.config.authAdminKey) {
    const handler = createMfaResetHandler({
      url: backend.config.supabaseUrl,
      publishableKey: backend.config.publishableKey,
      adminKey: backend.config.authAdminKey,
    });
    const response = await handler(
      new Request('https://internal.invalid/mfa-reset', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id }),
      }),
    );
    if (!response.ok) throw new ApiError(503, 'AUTH_JOB_INCOMPLETE');
    const result = object(await response.json());
    if (result['id'] !== id)
      throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
  } else {
    const result = object(
      await backend.request('/functions/v1/mfa-reset', 'POST', { id }, token),
    );
    if (result['id'] !== id)
      throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
  }
  await backend.rpc(
    'mfa_reset_job',
    { p_case: id, p_finish: true },
    token,
    true,
  );
  return { id };
}
