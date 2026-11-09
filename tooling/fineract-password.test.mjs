import test from 'node:test';
import assert from 'node:assert/strict';
import { localStaffPassword } from '../scripts/fineract-test-credentials.mjs';

test('disposable staff credentials satisfy the pinned upstream strong policy without repeats', () => {
  // Exact external acceptance criterion from upstream migration 0152.
  const policy =
    /^(?!.*(.)\1)(?!.*\s)(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[^\w\s]).{12,50}$/;
  const generated = new Set();
  for (let i = 0; i < 1000; i++) {
    const password = localStaffPassword();
    assert(policy.test(password));
    assert(!generated.has(password));
    generated.add(password);
  }
});
