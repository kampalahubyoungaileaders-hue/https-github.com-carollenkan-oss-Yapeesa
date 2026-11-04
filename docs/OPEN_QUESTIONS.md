# Open questions

These do not block Phase 0 code scaffolding.

1. Which locally purchased 2 GB Android 9 device will be the reference device?
   Validate Expo SDK 58 on it before accepting device and performance targets.
2. Provide a group cycle, a SACCO month, and a worked dividend example before
   their relevant phases. No financial rule is inferred from missing records.
3. The online workflow posts the server-calculated amount and preserves submitted
   inputs with a review flag. Define the later Fencher review/resolution authority
   and user-facing process before implementing that review interface.
4. Before offline approver PINs are implemented, define their enrolment, hashed
   local verification, lockout/recovery, revocation and second-factor interaction.
5. Phase 0 acceptance needs the Docker CI run plus a native development build on
   the reference device. Record failures rather than treating a JS export as a
   successful device test. Confirm PostgreSQL 17 against the pinned Fineract.
6. Before merging, require the `checks`, `local-stack`, `secure-web` and `web-browser` CI jobs through GitHub
   branch protection/rulesets. CI configuration alone does not prevent bypasses.

No payment features or new accounting rules are introduced by the current web
release. Free development hosting is configured; production readiness is separate.

7. The first administrator is verified and active, and public development hosting
   is configured. SMS recovery, organisation/group administration screens and
   production backup/restore verification remain before customer onboarding.
   No live savings groups or financial records have been invented.
