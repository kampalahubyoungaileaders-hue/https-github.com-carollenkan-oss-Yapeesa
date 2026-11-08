# Starting the next Group cycle

After a cycle's final share-out and every individual cash receipt are complete,
a verified Fencher administrator can use Administration → Manage group → Start
next cycle. Enter the actual agreed start/end dates and integer share price.
No dates, prices or financial amounts are supplied as hidden defaults.

The server requires the preceding cycle's saved finalization, no active cycle,
no open meeting, cleared share/income/loan/payable balances, and cash exactly equal
to the remaining Social reserve. The new start must be after the group's latest
recorded meeting. Planned dates in a cycle closed early remain historical inputs.

An immutable cycle-opening record links both cycles and the final share-out,
storing the post-payout cash and Social reserve without creating a new journal.
The first meeting starts with this amount, not the old pre-payout cash count.
Later meetings carry their preceding verified physical count as before.

New share purchases and distributions use the new cycle and share price. Earlier
shares, receipts, journals, cycle terms and member history remain available.
Starting a cycle does not copy old shares or create another Social contribution.
Permanent actor-bound request receipts prevent concurrent/retried cycle creation.
