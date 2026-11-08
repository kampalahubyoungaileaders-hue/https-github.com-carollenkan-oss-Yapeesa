# Online Group loans

On 8 November 2026, the user chose per-group rounding, partial-payment allocation
and monthly due dates, and selected agreed scheduled interest rather than a
monthly recalculation from actual unpaid principal. This release implements those
choices for savings groups. Lender and SACCO money remains with unmodified Fineract.

A verified platform administrator explicitly sets the monthly rate, flat or
scheduled declining method, total principal limit multiple, maximum term, total
interest rounding, allocation order, monthly date convention, eligible approver
roles, required distinct approval count and separation from the request recorder and borrower.
There are no hidden financial defaults. Disabling the current policy stops new
requests; existing requests and loans retain their saved policy.

Rates are exact integer basis points per month, entered as a percentage with up to
two decimal places. A rate above 10% per month shows the brief's warning. The term
is bounded to 120 monthly instalments as a technical limit. Principal must provide
at least one minor unit per instalment. The group chooses its own maximum term.

Principal uses equal whole-unit instalments with the residual in the last one.
Flat interest uses original principal for every scheduled month. Scheduled
declining interest uses original principal less the principal instalments scheduled
before that month. The chosen rounding applies to the total raw interest; earlier
monthly interest amounts use whole-unit floors and the remaining interest goes to
the last instalment. Principal plus interest must fit signed bigint. No money uses
floating-point arithmetic. Both SQL and shared-domain schedules must agree.

Original-day dates retain the original day across months, shortening only in
shorter months; a January 31 loan can therefore be due on February 28/29 and March 31. Month-end dates always use the final calendar day. Dates start from actual
cash disbursement. Request previews show indicative dates and disclose this.

A request stores its principal, term, reason and immutable policy. Current group
officers in the configured roles approve the terms through their own MFA sessions.
A platform-admin role alone cannot approve. The configured number of distinct
currently eligible officers is rechecked before disbursement; expired roles no
longer count. Approval is separate from cash movement. The designated writer,
signed in as secretary with MFA, explicitly records the cash handed over.

Borrowing capacity is the active cycle's recorded member share value times the
saved multiple, less that member's total outstanding principal. It is checked on
request, approval and disbursement. Multiple loans cannot circumvent the limit.
New borrowing requires current membership. The cash check protects both the
recorded ledger cash and the meeting's counted-cash history, keeping the social
reserve unavailable for lending. Share corrections and fine refunds also cannot
consume that reserve. Former members can settle existing loans without becoming
liable for the current meeting's new social contribution.

Disbursement debits loans receivable and credits cash. A repayment debits cash and
credits principal receivable and/or interest income. Partial payments settle
instalments chronologically, using the group's selected principal-first or
interest-first rule within each instalment. Payments may advance through future
instalments of the agreed schedule; the agreed interest is fixed. Overpayments are
rejected. There is no automatic extra late interest or penalty.

Every command uses a permanent actor-bound UUIDv7 receipt. Submitted preview
versions and amounts are retained separately from authoritative server amounts.
A differing preview is accepted and visibly flagged for review; it cannot alter
the posted calculation or be changed on replay. Review resolution remains the
separate authority question recorded in `OPEN_QUESTIONS.md`. An uncertain response
keeps the same frozen request for an explicit retry. A correction in the original
open meeting copies the original journal and swaps its sides exactly; it also
reopens the original instalment allocation. Each record can be reversed once.
Reverse all receipts before reversing their disbursement. Closed meetings remain
locked. No actual money transfer, automatic SMS or new live account is performed.

All seven tables use RLS and append-only records. The schedule view uses invoker
security and derives paid amounts and paid dates from receipt allocations. Members
see their own requests and loans; officers review their group. Direct authenticated
writes are revoked. The private posting role has no login, RLS bypass or Auth write
rights. The restricted eligibility helper examines only the caller or an already
recorded approval for a visible request. Financial commands share the existing
organisation lock and recheck permissions after waiting.

Cash movements and noncash loan decisions enter meeting fingerprints. Later
collections preserve older closing snapshots. Share-out includes collected loan
interest; uncollected interest and social money are excluded. Outstanding principal
is reported separately: preview is an estimate, and final payouts still require
all loans to be repaid. This release does not post final cycle payouts.

Validation covers generated schedules, monthly calendars, exact allocations,
SQL/domain parity, MFA/role checks, limits, social reserve protection, permanent
replay, reversals, privacy, CSV export and desktop/phone meeting closing. The test
command now includes every domain test file. Offline workflows and native Android
compilation remain deferred by the user's instruction.
