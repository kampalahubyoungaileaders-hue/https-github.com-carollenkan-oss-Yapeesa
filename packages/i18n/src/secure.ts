export const secure = {
  firstTimeSetup: 'First-time account setup',
  connectingSecurely: 'Connecting securely… Please keep this page open.',
  invitationDescription:
    'Use your invited phone number and SMS code, then choose a private PIN. You will set up an authenticator next.',
  requestSms: 'Request an SMS code',
  smsRequested:
    'If a pending invitation exists, a code has been requested. Check your phone and use the latest code.',
  smsCode: 'SMS verification code',
  choosePin: 'Choose a 6-digit PIN',
  confirmPin: 'Confirm your PIN',
  pinMismatch: 'The PINs do not match.',
  invitationError:
    'Setup could not be completed. Check your invitation and code. If your phone was already verified, try signing in with your chosen PIN or contact your administrator.',
  activateInvitation: 'Verify phone and save PIN',
  backToSignIn: 'Back to sign in',
  allSavedRecords: 'All saved records',
  savedWorkspace: 'Saved workspace',
  openSaved: 'Open saved records',
  sampleWorkspace: 'Explore sample workspace',
  signIn: 'Sign in',
  signOut: 'Sign out',
  loginHeading: 'Your group’s records, together.',
  loginDescription: 'Sign in to access the organisations you belong to.',
  phoneNumber: 'Phone number',
  pinLabel: '6-digit PIN',
  authPreparing:
    'Sign-in is being set up. You can still explore the sample workspace.',
  loadingRecords: 'Loading your records…',
  secondFactor: 'Verify your sign-in',
  factorDescription: 'Enter the code from your authenticator app to continue.',
  authenticator: 'Authenticator',
  verificationCode: 'Authenticator code',
  verifyCode: 'Verify code',
  setupAuthenticator: 'Set up an authenticator',
  setupDescription:
    'Add this setup key to your authenticator app, then enter its six-digit code.',
  setupKey: 'Setup key',
  noGroups: 'No savings groups assigned yet',
  noGroupsHelp:
    'Your organisation administrator needs to add your membership and an active cycle.',
  databaseSaved: 'Saved to your organisation',
  refreshRecords: 'Refresh records',
  savedTitle: 'Organisation records',
  savedDescription:
    'Share purchases and matching ledger entries from your group.',
  contributionsTotal: 'Share contributions',
  savedRecord: 'Share purchase saved.',
  savedReference: 'Saved reference',
  flaggedRecord:
    'Recorded with a calculation difference. The submitted value is preserved for review.',
  saveToGroup: 'Save to group',
  savingRecord: 'Saving…',
  retrySave: 'Retry this save',
  liveFormHelp:
    'The group’s cycle settings determine the amount. The server checks it before posting.',
  readOnlyRole: 'Your membership has read-only access to these records.',
  noActiveCycle:
    'This group needs an active savings cycle before recording shares.',
  pendingRetry:
    'The save has not been confirmed. Retry it before starting another record.',
  allMembers: 'All members',
  viewJournal: 'View journal',
  loginError: 'The phone number or PIN could not be verified.',
  lockedPin:
    'Sign-in is locked after five unsuccessful PIN attempts. Contact your administrator for account recovery.',
  permissionError:
    'Your current membership or assigned recording device does not allow this action.',
  mfaError: 'Complete authenticator verification to continue.',
  requestError: 'The request could not be completed. Please try again.',
  connectionError:
    'A connection could not be made. Your last confirmed records are still shown.',
  invalidShares:
    'Check the member, meeting date and share count against this group’s cycle settings.',
  duplicateRequest:
    'This reference was used for a different request. Refresh the records before trying again.',
  rateLimited: 'Too many attempts. Please wait before trying again.',
  sessionExpired: 'Please sign in again to continue.',
  showAllMembers: 'Show all members',
  secureGroupStatus: 'Connected organisation',
} as const;
