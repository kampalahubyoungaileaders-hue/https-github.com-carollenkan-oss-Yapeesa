# SMS PIN recovery

Choose **Forgot your PIN?** on the saved workspace's sign-in screen. Request an
SMS for the registered phone, verify the code, verify the existing authenticator
when required, and choose/confirm a six-digit PIN. Sign in again afterwards.
The existing signed EgoSMS Auth hook delivers the SMS. Nothing is sent until
the user presses **Request an SMS code**. Requests never create Auth accounts.

An SMS response alone does not open a normal Yapesa session. Recovery uses a
separate AES-GCM cookie with authenticated purpose, HttpOnly, SameSite Strict,
production Secure, a recovery-only path and a server-enforced ten-minute expiry.
It contains no PIN or refresh token. Renaming it to the regular session cookie
does not authorize access. PINs, codes and access tokens are never written to
browser storage or application logs.

Each privileged step rechecks the real Auth user, confirmed matching phone,
live database session and current MFA requirements. Pending invitations must
use first-time setup. Staff without a verified authenticator cannot recover by
SMS alone. A verified factor on any account also requires MFA. The reset uses
the user's own Auth token; no service key, Auth-table writes or new database
privileges are added.

After a confirmed PIN update, the existing protected gateway clears the phone's
PIN lock, and Auth globally signs the user out. Database session checks deny
revoked cookies immediately. Supabase also invalidates other sessions as part of
the password update. Supabase's password-update audit records remain the audit
source for this credential change. The raw PIN is transformed with the existing
server pepper before the provider hashes it.

If the password update is confirmed but lock/session cleanup fails, the UI says
the PIN changed and offers **Retry session cleanup**. The bounded cookie records
that the change was confirmed, so cleanup retries do not submit the PIN again.
The provider's same-password response also safely handles a repeated update
after an interrupted response. An uncertain network failure tells the user to
try signing in with their new PIN before requesting another SMS.

SMS requests are limited to three per hour per IP; SMS/MFA verification and PIN
completion are limited to five attempts per fifteen minutes per IP, in addition
to provider throttling. Unknown-phone requests return the same acknowledgement;
it does not promise that a message was delivered. No automatic resend or PIN
submission retry is performed.

This recovers a PIN while retaining the existing authenticator. Lost-factor or
lost-phone recovery needs a separate verified support policy and is not an MFA
bypass. Existing Supabase password-change protections remain enabled as configured;
a provider that requires the old password must use its approved recovery flow.

Unit tests cover cookie substitution/expiry, strict bodies/origins/rates, account
binding, pending/invalid users, staff MFA, revoked factors and cleanup retries.
Disposable real-Auth tests cover locked accounts, real OTP/MFA, old-PIN rejection,
session invalidation and replay denial. Desktop/phone browser tests exercise the
UI with reserved local fixtures. Only the local test-stack launcher injects test
OTP mappings, then restores the tracked configuration. No test codes are installed
in the hosted project, and automated tests never send a real SMS.
