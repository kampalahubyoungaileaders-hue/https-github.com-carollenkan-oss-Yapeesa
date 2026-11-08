# Staff onboarding

A verified platform administrator can create a group secretary, treasurer or
chair account from Administration. The administrator supplies the actual person's
name, phone, email, group, role and a reason. Existing ledger people can be selected
without renaming them. Existing linked Auth accounts use the existing role-assignment
workflow; this flow never silently relinks a phone to another account.

The email is an actual supplied address, never an invented placeholder. It provides
the account label required by the pinned Supabase Auth TOTP implementation (upstream
supabase/auth#2872). Neither email nor phone is automatically confirmed. Creating an
account sends no message. The recipient opens First-time account setup and explicitly
requests an SMS code, verifies phone possession and chooses a PIN. TOTP enrollment
and verification must succeed before the saved group role is inserted.

The immutable invitation and service-job events retain who authorized each phase.
The server-only staff-admin function reads an already-prepared, actor-authorized job
using the caller's JWT before using its Auth administration key. Clients cannot
supply a phone, Auth user ID, email or role to this function. The function can create
an unconfirmed account or activate only its bound invitation. It never transfers
money or grants platform administrator authority. Production uses the Edge Function's
default server credentials; local/self-hosted APIs may explicitly configure
SUPABASE_AUTH_ADMIN_KEY to run the exact same handler server-side.

Permanent actor-bound request IDs preserve retries after interrupted creation.
The role activates only if the original authorizing administrator remains eligible,
the group remains active and the recipient has a live AAL2 session. Interrupted
activation leaves an explicit Finish staff setup step. Revocation uses the existing
recorded membership workflow; it does not erase the invitation or old journals.

Validation includes negative service-handler tests, real local Auth and RLS tests,
and desktop/phone browser acceptance. Disposable test OTPs and example.invalid emails
exist only in the local test stack. Lost-authenticator recovery is separate work and
is not enabled by this onboarding flow.
