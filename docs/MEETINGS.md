# Saved online meeting records

Group officers open **Meetings** in the saved workspace. The secretary opens the
date, marks each member present, absent or excused, and records share purchases
through the existing ledger form. A meeting that already has share purchases can
be opened for attendance and reconciliation without duplicating those purchases.

The roster starts with active members and people with purchases at that meeting.
Reopening the same open date refreshes the roster with newly registered members.
A later share purchase also adds its member to the roster. Attendance changes
append a revision; no old attendance is overwritten. Attendance does not create
absence fines in this release.

The first opening uses earlier recorded cash. Later openings carry the physical
cash counted at the previous verified close. Earlier open meetings must close
first, and only one meeting can have an active opening snapshot. Unrecorded
opening balances require a separate reconciled import. A legacy closed meeting
without a verified closing record blocks carry-forward until it is reconciled.

## Count and close

The server computes expected cash as opening cash plus meeting cash debits minus
meeting cash credits, including saved reversals. The secretary enters the counted
cash and explains any difference, then chooses **Prepare closing**. This creates
an immutable snapshot and does not alter the ledger or close the meeting.

Two different active group officers approve that same snapshot. Each signs in
with their own PIN and authenticator. Officers can approve from their own browser;
recording attendance and preparing the close still require the designated writer
device. Platform administrators can review records but need an explicit group
officer role to sign. One person holding several officer roles still counts once.

A changed ledger, roster or attendance makes an earlier closing snapshot stale.
The secretary must prepare a new snapshot and collect approvals again. Previous
snapshots and signatures remain in the audit history. Ending an officer role
prevents that signature from counting toward a later close. A signature records
verified consent at its original time; signing out does not erase that consent.

After two eligible approvals, the meeting locks. New purchases, reversals and
attendance edits for it are rejected. Backdated money entries cannot alter an
already opened or closed later meeting's opening balance. Commands use the same
organisation lock as financial posting and permanent actor-bound replay receipts.

Count differences remain visible without a balancing journal being invented.
The next opening carries counted physical cash; book cash and the unresolved
count difference remain separately auditable. Later-period balance adjustments
and correction of closed meetings require an agreed adjustment policy.

## Scope and verification

This is the online attendance/share-ledger/cash-close workflow. Loans, repayments,
social contributions, grants and fines still require their saved workflows. The
full offline meeting and offline approval PIN policy remain separate work. No
extra SMS, test customers or hosted financial records are created by verification.

The executor role has no login, RLS bypass, Auth writes or ledger-posting grants.
New records are append-only and RLS-protected. Members can read their own
attendance rows; officers can review their group. API responses are not cached.
The domain bigint and SQL numeric cash calculators are checked for parity.

CI covers replay conflicts, stale approvals, role revocation, closed-history
locking, count carry-forward, concurrent last approval versus financial posting,
organisation isolation, immutable records and generated cash-calculation parity.
Desktop and phone browser tests cover attendance, interrupted-save retry,
required explanations, two independently signed-in officers, lock and reload.
