# Open questions

These do not block Phase 0 code scaffolding.

1. Which locally purchased 2 GB Android 9 device will be the reference device?
   Validate Expo SDK 58 on it before accepting device and performance targets.
2. Provide a group cycle, a SACCO month, and a worked dividend example before
   their relevant phases. No financial rule is inferred from missing records.
3. During Phase 1, define how a calculation mismatch is accepted and flagged
   while preserving balanced ledger postings: which amount is the posted amount,
   what is held for review, and who may resolve it?
4. Before offline approver PINs are implemented, define their enrolment, hashed
   local verification, lockout/recovery, revocation and second-factor interaction.
5. Phase 0 acceptance needs the Docker CI run plus a native development build on
   the reference device. Record failures rather than treating a JS export as a
   successful device test. Confirm PostgreSQL 17 against the pinned Fineract.
6. Before merging, require the `checks` and `local-stack` CI jobs through GitHub
   branch protection/rulesets. CI configuration alone does not prevent bypasses.

No payment features, new accounting rules, or production hosting are in scope.
