# Online social fund

Offline workflows are deferred. This workflow records money; it does not send or
receive payments. Social money has its own liability account and never becomes
share capital or part of the recorded share-out fund.

## Choose the group's rules

A verified platform administrator selects the group and opens **Social fund**.
Enter the agreed contribution in whole currency minor units, choose the officer
roles allowed to approve grants and corrections, choose whether the requester
needs another officer's approval, and choose whether every roster member must
have paid before closing. All choices are explicit; no amount or approval rule is
silently assumed. Disabling the fund affects new meetings, not old commitments.

Opening a new meeting captures its social rule. For an older open meeting, the
secretary can explicitly **Start social fund for this meeting**. That rule then
stays fixed for the meeting, including after a later configuration change.

## Contributions and grants

The designated secretary records each active member's contribution. The server
uses the fixed meeting amount and rejects duplicate contributions. After an
approved correction, the correct full contribution can be recorded again.

The secretary requests a grant for a member with an amount and reason. A
configured, currently active group officer signs in with their own PIN and
verified authenticator and chooses **Approve and record cash change**. This
records the cash outflow atomically with approval. Approval checks the separate
social balance and the meeting's available counted cash; share capital cannot
finance a social grant. Pending requests do not reserve or move money. The
secretary can cancel an unapproved request.

Corrections also need approval under the meeting's rule. The server copies the
original journal and swaps its sides, preserving the original record and linking
an exact reversal. Reversing a reversal or correcting one entry twice is rejected.
An unavailable fund cannot be made negative by correcting a contribution already
spent. Closed meetings cannot be changed.

## Reconcile and report

Meeting cash reconciliation includes social contributions, grants and corrections.
Unresolved requests block closing. Where the saved rule requires all members to
pay, every roster member needs their full net contribution. New social activity
makes earlier closing approvals stale. Completed old meetings without social
activity keep their existing fingerprints and history.

The social ledger displays signed cash movement and its balanced journal. Export
**social records CSV** for all entries the signed-in user can access. The share
PDF and CSV remain share-only and are hidden while viewing the social ledger.
Members see their own social records; only officers see the complete fund balance.

The implementation uses permanent actor-bound replay receipts, the same group
lock as share posting and closing, append-only policy/request/transaction/history
tables, RLS and a private NOLOGIN/NOBYPASSRLS executor with no Auth writes. Approval
roles and recording authority are checked under the lock. API validation checks
each returned journal against the shared bigint calculator and checks the fund
against its signed transaction total.

Verification uses disposable local Auth/database fixtures. It covers exact
fund/share separation, policy history, equal contributions, duplicate delivery,
configured roles and requester separation, insufficient funds, corrections,
mandatory closing checks, member isolation, immutable records, and desktop/phone
sessions for administrator, secretary and treasurer. No live sample accounts,
financial records or SMS are created by the tests.

Loans/repayments, fines and final cycle share-out remain separate online work.
