export const finalShareout = {
  cycleStartTitle: 'Start next cycle',
  cycleStartIntro:
    'Create a new cycle after the previous distribution is finalized. Earlier records remain locked. The first meeting carries the remaining Social cash.',
  cycleCarryCash: 'Opening cash carried forward',
  cycleSocialReserve: 'Protected Social reserve',
  cycleMinorUnits: '(minor units)',
  cycleNewStart: 'New cycle start date',
  cycleNewEnd: 'New cycle end date',
  cycleNewPrice: 'New cycle share price (minor units)',
  cycleConfirm:
    'I confirm these are the group’s agreed dates and share price, and that the remaining Social cash is held for the next cycle.',
  cycleStartButton: 'Create next cycle',
  cycleRetry: 'Retry the same cycle setup',
  cycleNotReady:
    'Complete the previous share-out, record every payout and reconcile cash before starting another cycle.',
  finalTitle: 'Final cycle share-out',
  finalRefresh: 'Refresh final share-out',
  finalIntro:
    'Prepare a fixed allocation after closing meetings and settling loans and fines. Two officers approve it before individual cash handovers are recorded. Social money stays reserved.',
  finalError:
    'Could not load final share-out. Refresh to check the saved records.',
  finalBlocked: 'Before you can prepare share-out',
  finalReady: 'Ready to prepare an allocation',
  finalPrepare: 'Prepare final allocation',
  finalPrepareConfirm:
    'I have reviewed the fund and want to prepare this cycle for final share-out.',
  finalReview: 'Review the saved allocation',
  finalStale:
    'This proposal is stale. Resolve the prerequisites and prepare a new allocation.',
  finalApprove: 'Approve final allocation',
  finalApproveConfirm:
    'I have reviewed every allocation and approve this final distribution.',
  finalApprovalCount: 'Current officer approvals',
  finalApproved:
    'Allocation approved. Cycle activity is locked; cash handovers can now be recorded.',
  finalAlreadyApproved: 'Your approval is recorded.',
  finalPayTitle: 'Record a member cash handover',
  finalPayMember: 'Member receiving the payout',
  finalPayReason: 'Receipt reference or payout note',
  finalPayConfirm:
    'I handed this member the full amount shown and received their acknowledgement.',
  finalPay: 'Record cash payout',
  finalFinishConfirm:
    'Every positive allocation has a cash receipt. I confirm the cycle can close.',
  finalFinish: 'Finalize cycle',
  finalDone:
    'Cycle finalized. All payouts are recorded; the Social reserve is retained.',
  finalRemaining: 'Payouts still to record',
  finalCash: 'Recorded cash before distribution',
  finalSocial: 'Protected Social reserve',
  finalFund: 'Final distributable fund',
  finalPending: 'Awaiting cash handover',
  finalPaid: 'Cash handover recorded',
  finalZero: 'No cash payout due',
  finalRetry: 'Retry the same share-out command',
  finalUncertain:
    'The result is not yet confirmed. Retry the same command to check it safely.',
  finalRejected:
    'Share-out could not be saved. Refresh and check prerequisites, officer authority and the designated writer device.',
  finalSaved: 'Share-out record saved.',
  finalSavedRefresh:
    'The record was saved, but refresh failed. Refresh before continuing.',
  finalExport: 'Export payout register',
  finalReceipt: 'Cash receipt',
  finalChooseMember: 'Choose a member',
} as const;
