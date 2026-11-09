import { randomBytes } from 'node:crypto';

// Fineract 1.12.0 migration 0152 activates the strong password policy, including
// its no-consecutive-repeated-characters rule. Never relax that policy for tests.
export function localStaffPassword() {
  let password;
  do {
    password = `Q7!${randomBytes(18).toString('base64url')}a`;
  } while (/(.)\1|\s/.test(password));
  return password;
}
