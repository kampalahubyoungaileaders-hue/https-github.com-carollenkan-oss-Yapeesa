# Lost-authenticator recovery

The recipient first verifies their phone using the existing explicit SMS recovery
flow. A ten-minute purpose-bound encrypted HttpOnly recovery cookie authorizes an
immutable request with a reason. This cookie cannot authorize ordinary group APIs.
A request does not remove factors, change roles or reset the PIN.

Two distinct current verified platform administrators must independently record
identity-verification evidence and explicitly attest to their checks. Neither can
approve their own request. Approvals remain attributable and immutable, and stop
counting when an administrator loses eligibility. The exact factor IDs are captured
at request time. Any new factor makes an unprepared request stale and requires
project-owner review; the application does not silently expand the reset scope.

After two eligible approvals, an authorized administrator can run the bounded reset
job. The job is recorded before a server-only function reads its context with the
caller's JWT. Only then does the function use Auth admin credentials. It deletes
only the recorded TOTP factors, verified factors first. Supabase downgrades affected
sessions to AAL1 when a factor is deleted; the SQL recovery lock independently blocks
all staff and financial access, including refreshes of those sessions. SQL separately checks real Auth
session rows and factor status. Partial failures retain a safe retry; newly added
factors cannot be deleted through an old request.

From reset preparation, the real database AAL2 check blocks financial and staff
access. After reset the person must verify a fresh SMS code in a newly created
session, enroll a new TOTP factor and verify it. A purpose-bound recovery endpoint
then records completion. Only this fresh SMS/new-factor proof removes the recovery
lock. PIN changes continue through the existing recovery flow with global session
cleanup; no money or journal adjustments occur.

Recovery records, approvals, phases, actors, evidence and timestamps form a private,
append-only identity audit trail. They are separate from organisation financial
journal audit entries. Clients have no table writes; the SQL recovery executor has
no Auth-factor deletion grant and no financial journal write grant. Only the narrow
server function has Auth administration credentials. Ordinary email/PIN or an old
access token cannot substitute for the required fresh SMS/new-factor proof.

If the live installation has only one eligible platform administrator, this workflow
intentionally cannot reset a lost factor. A project owner must arrange and verify a
second administrator through the existing controlled bootstrap process. The
application never lets a group administrator grant platform administrator authority.
Unsupported factor types and changed/stale identity records require project-owner
review. This flow does not invent a policy for discarding or rewriting those records.
