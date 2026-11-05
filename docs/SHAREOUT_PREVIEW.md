# Recorded share-fund preview

In the saved Groups **Overview**, choose **Preview share-out**. Group officers
with verified MFA see the active cycle's recorded fund, net shares, and estimated
allocation per member. Use **Refresh preview** for a new snapshot. Saving a new
purchase or reversal clears the previous preview so it cannot appear current.

This first preview covers saved share purchases and their corrections only. It
excludes loan earnings, fines and social-fund handling, which require their saved
workflows. It is not a final full-cycle distribution. No payout or cycle closure
is recorded. Repaid-loan and two-officer approval checks belong to the eventual
final share-out command.

The fund is independently read from cash journal lines and checked against the
signed transaction total for the active cycle. Each member receives their floor
quota, with remaining minor units allocated in descending fractional-remainder
order. Ties use ascending member ID. No JavaScript floating-point money is used.
The allocations always sum exactly to the fund, including with many tiny shares.

The SQL and shared-domain calculations must agree before the API displays a
preview. Both use `groups-shareout-preview-v1`. Organisation isolation, real
session/MFA checks and officer permissions apply. Ordinary members cannot request
another member's allocation. The response is never cached.

Tests include generated integer funds up to signed bigint maximum, sums, quota
bounds, order independence, ties, zero funds, SQL/domain parity, revoked/ordinary
permissions, signed corrections, and desktop/phone browser rendering.
