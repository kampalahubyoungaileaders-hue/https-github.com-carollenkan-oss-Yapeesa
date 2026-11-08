# Group reviews

The Reviews tab lists recorded share/loan calculation differences and their saved
review cases. Ordinary members cannot browse the queue. Verified Fencher
administrators can inspect it; decisions require actual current group officer
roles and MFA, including for an administrator who wants to participate.

An officer opens a case with a reason. The server captures the eligible original
record, including client inputs, authoritative amounts and calculation version.
Money in evidence is serialized as integer strings. The source cannot be changed.

An officer proposes an outcome and reason. Two distinct current officers approve
that exact latest proposal. Replacing a proposal stales earlier consent; removed
roles no longer count. Outcomes confirm the original record or record that a
correction is required. Both are append-only decisions; neither changes money.
The original discrepancy flag remains as historical evidence, with the separate
review decision linked beside it.

Closed-meeting/completed-share-out review requests preserve the original closing
or distribution snapshot. Eligible closed journal IDs are also supported by the
API for disputed entries. Closed financial history stays locked. A correction
required decision awaits a separately approved worked adjustment policy.

Actor-bound UUIDv7 commands replay permanently. Clients cannot insert or edit
review tables directly. The review executor has no journal-write privileges.
CSV exports include references, reasons, proposing/requesting actors and decisions.
