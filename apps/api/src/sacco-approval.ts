import { ApiError } from './backend.js';
import { saccoOperations, saccoPayload } from './sacco-catalog.js';
export const independentOperations = new Set([
  'share.apply',
  'share.approve',
  'share.activate',
  'share.purchase',
  'share.redeem',
  'dividend.declare',
  'dividend.approve',
]);
export function independentCommand(
  input: Record<string, unknown>,
  roles: string[],
  permissions: string[],
) {
  const operation = saccoOperations.find((op) => op.id === input['operation']);
  if (
    !operation ||
    !independentOperations.has(operation.id) ||
    !operation.roles.some((role) => roles.includes(role)) ||
    !permissions.includes(operation.permission)
  )
    throw new ApiError(403, 'PERMISSION_DENIED');
  const raw = input['values'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new ApiError(400, 'INVALID_SACCO_FIELDS');
  const body = saccoPayload(operation, raw as Record<string, unknown>);
  let path = operation.path;
  for (const [key, placeholder, needed] of [
    ['record', '{id}', operation.target],
    ['sub_record', '{subId}', operation.subTarget],
  ] as const) {
    const value = input[key];
    if (needed) {
      if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value))
        throw new ApiError(400, 'INVALID_SACCO_REFERENCE');
      path = path.replace(placeholder, value);
    } else if (value !== undefined)
      throw new ApiError(400, 'INVALID_SACCO_REFERENCE');
  }
  return { operation, body, path };
}
