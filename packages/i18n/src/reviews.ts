export const reviews = {
  reviewsTitle: 'Reviews',
  reviewsIntro:
    'Review calculation differences and request checks of closed records. Original calculations and journals remain unchanged. Two current group officers must approve the same outcome.',
  reviewsRefresh: 'Refresh reviews',
  reviewsLoadError: 'Could not load reviews. Refresh and try again.',
  reviewsSaved: 'Review record saved and audited.',
  reviewsSavedRefresh:
    'The review was saved, but refresh failed. Refresh before continuing.',
  reviewsRejected:
    'Review not saved. Check the source, current officer roles and latest proposal.',
  reviewsUncertain:
    'The result is not yet confirmed. Retry the same command safely.',
  reviewsRetry: 'Retry the same review command',
  reviewsReadOnly:
    'Your role can inspect these reviews. Current group officers propose and approve outcomes.',
  reviewsMismatches: 'Calculation differences',
  reviewsNoMismatches: 'No calculation differences are recorded.',
  reviewsOpen: 'Open calculation review',
  reviewsLinked: 'A review is already recorded for this difference.',
  reviewsClosedTitle: 'Request a closed-record review',
  reviewsClosedIntro:
    'This records a review request. It does not reverse a closed transaction or reopen a completed share-out.',
  reviewsClosedSource: 'Closed record to review',
  reviewsChooseSource: 'Choose a closed record',
  reviewsMeeting: 'Closed meeting',
  reviewsShareout: 'Completed share-out',
  reviewsReason: 'Reason and supporting details',
  reviewsRequest: 'Save review request',
  reviewsCases: 'Review cases',
  reviewsEmpty: 'No review requests yet.',
  reviewsEvidence: 'Original recorded evidence',
  reviewsPropose: 'Propose review outcome',
  reviewsOutcome: 'Review outcome',
  reviewsChooseOutcome: 'Choose an outcome',
  reviewsConfirmed: 'Original records confirmed',
  reviewsCorrection:
    'Correction required — awaiting an approved adjustment process',
  reviewsProposedReason: 'Reason for the proposed outcome',
  reviewsProposeSave: 'Save proposed outcome',
  reviewsLatest: 'Latest proposed outcome',
  reviewsApprovals: 'Current officer approvals',
  reviewsApproveConfirm:
    'I reviewed the original evidence and agree with this proposed outcome and reason.',
  reviewsApprove: 'Approve review outcome',
  reviewsAlreadyApproved: 'Your approval is recorded.',
  reviewsDecision: 'Two-officer decision recorded',
  reviewsOriginalLocked: 'The original ledger remains locked.',
  reviewsExport: 'Export review register',
  reviewsReference: 'Record reference',
} as const;
