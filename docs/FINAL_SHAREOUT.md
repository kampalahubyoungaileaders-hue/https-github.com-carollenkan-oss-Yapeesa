# Final cycle share-out

Decisions confirmed on 8 November 2026: collect or explicitly waive every unpaid
fine before distribution; block distribution when cash does not reconcile; record
each member's cash handover separately after two officers approve the allocation.
Social money remains separate. No payment transfer is performed.

The secretary prepares a saved allocation only after every meeting is closed with
a verified cash count, all principal and agreed interest are settled, pending loan
requests are cancelled or disbursed and repaid, and fines are resolved. The last
physical cash count must equal recorded cash, including the Social reserve.
The fund is savings plus collected fines and collected loan interest. It must
exactly equal cash less the Social reserve. No shortage is silently written off.

Two distinct current group officers approve the same unchanged snapshot using
their own verified sessions. The second approval locks cycle activity and moves
share capital and collected income to a share-out payable account. Cash is not
reduced by approval. Immutable per-member allocations use the existing integer
largest-remainder calculator and preserve its inputs and calculation version.

The designated secretary records each actual cash handover against its fixed
allocation, with a confirmation and receipt reference/reason. A payable debit and
cash credit accompany each receipt. Zero allocations need no cash receipt. UUIDv7
commands are permanently actor-bound and replay safely, including after closure.
The cycle closes only when all positive allocations have receipts, the payable is
zero and remaining cash equals the Social reserve. Closed-meeting and post-share-out
adjustments remain locked pending an approved adjustment policy.

Preparing a replacement proposal makes earlier proposals ineligible for approval.
Changes to any inputs also invalidate pending approval. Existing member and journal
history is retained. Starting another cycle is a separate explicit administration
step; no dates, prices, cash write-offs or future-cycle terms are invented.
