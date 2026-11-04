import { ApiError, Backend, object, tokensFrom } from './backend.js';
import { deriveAuthPassword } from './security.js';

// This flag is set by a project administrator, never by user_metadata.
export function pendingInvitation(user: Record<string, unknown>): boolean {
  const metadata = user['app_metadata'];
  return (
    !!metadata &&
    typeof metadata === 'object' &&
    'yapesa_activation' in metadata &&
    metadata.yapesa_activation === 'pending'
  );
}

export async function acceptInvitation(
  backend: Backend,
  input: { phone: string; code: string; pin: string },
) {
  const tokens = tokensFrom(
    await backend.auth('verify', {
      phone: input.phone,
      token: input.code,
      type: 'sms',
    }),
  );
  try {
    const user = object(
      await backend.auth('user', undefined, tokens.access_token),
    );
    const factors = Array.isArray(user['factors']) ? user['factors'] : [];
    if (
      !pendingInvitation(user) ||
      !user['phone_confirmed_at'] ||
      user['phone'] !== input.phone.slice(1) ||
      factors.some((factor: unknown) => object(factor)['status'] === 'verified')
    )
      throw new ApiError(403, 'INVITATION_REQUIRED');
    const context = await backend.rpc(
      'session_context',
      {},
      tokens.access_token,
    );
    if (!context) throw new ApiError(403, 'INVITATION_REQUIRED');
    await backend.request(
      '/auth/v1/user',
      'PUT',
      {
        password: deriveAuthPassword(
          input.phone,
          input.pin,
          backend.config.pinPepper,
        ),
      },
      tokens.access_token,
    );
    return tokens;
  } catch (error) {
    // A failed activation must not leave the new OTP session usable.
    try {
      await backend.auth('logout?scope=local', {}, tokens.access_token);
    } catch {
      /* Preserve the original failure; no browser cookie was issued. */
    }
    throw error;
  }
}
