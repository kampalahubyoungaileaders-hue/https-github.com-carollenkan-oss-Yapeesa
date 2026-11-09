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
6. Main-branch protection now requires pull requests and the `checks`,
   `local-stack`, `secure-web` and `web-browser` jobs, including for administrators.
   Keep these requirements when changing CI.

No payment-transfer integration is introduced by the current web release. Free development hosting is configured; production readiness is separate.

7. The first administrator is verified and active, and public development hosting
   is configured. Group administration, ledger-member registration and existing verified staff
   assignments and SMS PIN recovery are implemented. Staff-account invitations and two-administrator lost-authenticator recovery are
   implemented. Production backup scheduling, retention and a hosted
   restore exercise remain before customer onboarding.
   No live savings groups or financial records have been invented.

8. Define the approved adjustment process for a closed meeting or a cycle already
   shared out. The current saved reversal workflow handles open meetings only and
   keeps closed records locked.
9. Resolved on 8 November 2026: groups explicitly select interest rounding,
   partial-payment allocation and monthly due-date/month-end conventions. The
   user selected agreed scheduled interest, with no automatic extra interest
   from late or partial payments. Both interest methods and final-instalment
   residuals remain. See `GROUP_LOANS.md` for the precise reviewed behavior.

10. Resolved on 8 November 2026: final cycle share-out requires all fines to be
    collected or explicitly waived, blocks unreconciled cash, and records individual
    cash handovers after two officers approve. Social money stays separate.
    Next-cycle setup must preserve the remaining Social reserve and start with its
    actual post-distribution cash, rather than reusing the last pre-payout count.

11. Confirmed on 8 November 2026: two distinct current group officers resolve
    calculation-mismatch reviews, preserving original calculations and journals.
    Closed-meeting and completed-share-out correction requests enter an auditable
    review queue; money stays locked pending a worked correction policy.
12. Confirmed on 8 November 2026: lost-authenticator resets require recorded
    identity verification and two distinct verified administrators, with no
    self-approval. The owner-only emergency recovery path remains external.
