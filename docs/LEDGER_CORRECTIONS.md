# Correcting saved share purchases

In the saved workspace, open **Ledger**, select a purchase, enter a required
**Reason for correction**, and choose **Reverse this purchase**. The original
purchase stays visible with a link to the reversal. Enter a replacement purchase
separately when needed. A reversal records a correction; it does not move money.

The current correction path is for open meetings in the active cycle. Closed
meetings remain locked. A later-period adjustment policy is needed before
correcting a closed meeting or a distributed cycle; do not reopen one by editing
SQL or deleting records.

Only the group's assigned secretary, signed in with verified MFA, can correct a
purchase, using the designated writer device. Former members' old purchases can
be corrected without reactivating their membership. A platform administrator has
no automatic posting authority.

The server copies every original journal account and amount and swaps its side.
The appended transaction has negative shares/value and a same-organisation
`reverses` reference. The original is unchanged. One reversal is allowed for each
purchase; reversing a reversal is rejected. Signed totals restore the meeting
share limit as well as the cash/share-capital balances. PDF and CSV exports retain
both entries, signed amounts, reasons and the original transaction reference.

The request reference is bound to its payload and actor. The organisation lock
serializes purchases, administration and corrections. Concurrent corrections
produce one success and one conflict. A lost response can be retried with the
same reference and returns the original receipt. No mutation retries itself.

Keep the page open and use **Retry this correction** after an interrupted response.
If the page was closed, refresh the ledger before trying again. The database's
unique original-transaction constraint still prevents a second reversal even
when the browser no longer has the pending reference.

Verification includes shared-domain reversal properties, real Auth/database
isolation, concurrent delivery, payload conflict, exact per-account restoration,
restored share limits, closed-meeting rejection, signed PDF generation and
browser correction/reload checks on desktop and phone sizes. CI uses disposable
fixtures. No hosted financial records or SMS are created by these tests.
