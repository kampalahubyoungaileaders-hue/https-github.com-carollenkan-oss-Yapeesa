# Programme reports

Verified platform administrators create programmes, explicitly link existing groups
and grant/revoke programme-officer membership. A group has one current parent;
relinking requires an explicit unlink first. Changes have stable retry UUIDs and
recorded reasons in the administration audit trail. They do not move balances.
New programme officers can use the same controlled staff invitation, phone/PIN
activation and TOTP process as group staff. Programme roles cannot be invited into
groups or group roles into programmes. Existing staff must have verified phone and
TOTP setup before assignment.

A verified programme officer sees only programmes currently assigned to them and
aggregate reports for their currently linked groups. Programme membership does
not grant group membership, member identities, individual transaction records,
audit PDFs or money permissions. A separate SELECT-only executor has scoped RLS;
client roles cannot execute its internal scope helper. Revoking a role or unlinking
a group removes its report scope on the next request, including existing sessions.

The dashboard identifies active groups with no recorded meeting, or no meeting in
at least 21 days, and groups with overdue scheduled loan repayments. It reports
last meeting, current member count, net share contributions, outstanding principal,
loans in arrears, and exact principal-plus-interest arrears aged 1–30, 31–60, 61–90
and over 90 days. Instalments due today are excluded from arrears. Repayment and
reversal allocations are applied exactly; reversing a disbursement removes that
cancelled loan. No extra late interest, currency conversion or new loan policy is
introduced. Inactive groups remain labelled and included in monetary totals, but
do not receive active-group attention flags.

Twelve calendar months show recorded meetings, roster places, latest attendance
marks, unmarked places, net shares, scheduled dues and net cash repayments. A
repayment and its exact reversal can appear in different months, so net repayments
may be negative and are not presented as a same-month repayment rate. Scheduled
dues cover loans still disbursed at the selected as-of meeting date. As-of reports
use currently recorded source facts assigned to meeting dates, current programme
links and current membership counts; they are not a reconstruction of what was
known before a later backdated entry or attendance correction. The programme time
zone defines the default report date. An explicit date is shown throughout.

Every amount remains an integer string in its own currency and scale. Totals are
separate by currency. CSV exports include group IDs, report date, raw minor-unit
amounts and monthly aggregate rows, never member IDs. Downloads use the common
CSV escaping rules. Reports fail rather than truncate beyond the current bounded
500-group capacity; this limit must be raised with pagination/performance proof
before onboarding a larger programme.

Disposable tests cover real phone/PIN/MFA sessions, administration retry receipts,
programme isolation and role/type restrictions, no direct group or person access,
latest attendance, partially paid overdue loans, exact repayment reversals,
separate currencies, immutable journal counts during reads, invitation activation,
and immediate unlink/revocation. Desktop/phone acceptance creates programme links
through the UI, verifies attention filters, opens all twelve trend months, downloads
a CSV, and verifies revoked reports disappear. No hosted fixtures or SMS are used.
