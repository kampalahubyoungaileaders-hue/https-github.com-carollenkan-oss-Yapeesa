export const authenticatorRecovery = {
  mfaRecoveryTitle: 'Lost-authenticator recovery',
  mfaRecoveryHelp:
    'Two separate verified platform administrators must record how they verified this person’s identity. The person cannot approve their own request. Resetting factors locks group access until a fresh SMS and new authenticator are verified.',
  mfaLost: 'I have lost my authenticator',
  mfaReason: 'Reason for authenticator recovery',
  mfaRequest: 'Save authenticator recovery request',
  mfaRetryRequest: 'Retry saved recovery request',
  mfaRequestSaved: 'Recovery request saved. Reference:',
  mfaAwaiting:
    'Ask two verified platform administrators to review this reference and record identity verification. After the approved reset, request and verify a fresh SMS code here to set up a new authenticator.',
  mfaCheck: 'Return to SMS verification',
  mfaEvidence: 'How did you verify this person’s identity?',
  mfaAttest: 'I verified this person’s identity independently',
  mfaApprove: 'Record my identity verification',
  mfaReset: 'Reset approved authenticator factors',
  mfaResetRetry: 'Retry approved factor reset',
  mfaResetDone: 'Factors reset; awaiting fresh SMS and a new authenticator',
  mfaRecovered: 'New authenticator verified',
  mfaApprovalCount: 'Eligible independent approvals',
  mfaSelf: 'You cannot approve or reset your own request.',
  mfaRecoverySaved: 'Recovery action recorded and audited.',
  mfaRecoveryError:
    'Could not complete recovery. Check the approvals and retry the saved action.',
  mfaRecoveryEmpty: 'No authenticator recovery requests.',
} as const;
