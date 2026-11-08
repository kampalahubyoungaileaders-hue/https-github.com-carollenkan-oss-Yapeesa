# Online fines

The user chose to track unpaid fines and collect payments separately. Assessments
are obligations, not accrued income: they do not post a journal or increase cash.
A receipt debits cash and credits fine income. Waiving an unpaid amount creates an
append-only noncash event with a reason. No workflow transfers money.

A verified platform administrator explicitly configures each fine's code, name,
positive amount in minor units, manual/absence trigger and partial-payment rule.
No fine types or amounts are supplied as defaults. A maximum of twenty types,
including one absence type, bounds configuration and keeps absence unambiguous.
Opening a meeting captures the complete policy; later changes affect future
meetings. Existing meetings without a captured policy do not acquire one later.
An empty saved list disables new assessments in future meetings.

The designated writer, signed in as the group's secretary with MFA, can assess a
manual fine, record a payment, waive the remaining unpaid amount with a reason,
or reverse a receipt exactly. Cash receipts cannot exceed the outstanding amount;
partial receipts are allowed only if the charge's saved rule permits them.
Outstanding balances can be collected at a later open meeting, including when the
original meeting is closed. The receipt belongs to the collection meeting and
cannot change the older cash count or approvals. A former member settling an
old fine is not added to the current member roster or charged its new social
contribution.

Marking attendance absent automatically assesses the saved absence fine, once per
transition into absence. Repeated absent saves do not duplicate it. Present or
excused attendance creates no automatic fine. Correcting absence waives its unpaid
amount automatically; if cash has already been collected the secretary must first
reverse those receipts in their still-open collection meeting. Closed-meeting
adjustments remain outside this release. Waivers do not refund money. To correct a
wrong paid fine, reverse its receipt, then waive the newly unpaid amount.

Only receipts from the selected open meeting can be reversed. The original record
and journal remain, and the new journal exchanges the original sides. A receipt
can be reversed once; a reversal cannot be reversed. All actions use permanent,
actor-bound UUIDv7 receipts. An uncertain response retains the same frozen request
for an explicit retry. Later financial or noncash fine activity invalidates an
existing closing proposal for that meeting. An unpaid fine can remain after a
meeting closes and stays visible for later collection or waiver.

Fine receipts and their reversals enter cash reconciliation and the active cycle's
share-out preview. Unpaid or waived amounts and social money are excluded. The [final cycle workflow](FINAL_SHAREOUT.md) requires every unpaid fine to be
collected or explicitly waived before distribution.
Share passbooks/PDFs remain scoped to shares. Fines have separate member-balance
and event-history CSV exports, and expandable balanced receipt journals.

All four new tables use RLS. Members see only their own charges/events; officers
review their group. Direct authenticated writes are revoked. The bounded private
executor has no Auth write permission, login or RLS bypass. Configuration, posting
and meeting operations share the same organisation lock. Closed/backdated history
is guarded, and former recipients' names remain available to authorised officers.
Disposable database and desktop/phone browser tests cover obligations, automatic
absence corrections, saved terms, partial/full-only rules, replay, overpayment,
waiver, reversal, later collection, cash/share-out parity, privacy and closing.
Offline workflows remain deferred.

Integration test files run sequentially because they share disposable Auth
identities and TOTP factors. Production authentication limits are unchanged.
