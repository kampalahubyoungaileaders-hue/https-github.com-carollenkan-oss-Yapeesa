export const staff = {
  staffTitle: 'Staff account setup',
  staffHelp:
    'Create a staff account for a group officer. Access starts only after they verify their phone, choose a PIN and set up an authenticator. No SMS is sent until they request a setup code.',
  staffName: 'Staff full name',
  staffEmail: 'Staff email address',
  staffEmailHelp:
    'Use their actual email address. Supabase currently requires an email label for authenticator setup; phone verification remains required. No confirmation email is sent by this action.',
  staffPhone: 'Staff phone number',
  staffPerson: 'Existing person (optional)',
  staffNewPerson: 'Create a new person',
  staffGroup: 'Staff group',
  staffRole: 'Staff role',
  staffReason: 'Reason for access',
  staffCreate: 'Create staff account',
  staffRetry: 'Retry saved account setup',
  staffSaved:
    'Staff account prepared. Ask this person to open First-time setup and verify the phone shown below.',
  staffPending:
    'Account setup needs a retry. The saved request will be used again.',
  staffWaiting: 'Waiting for phone, PIN and authenticator setup',
  staffActive: 'Staff setup completed',
  staffUnfinished: 'Account creation needs a retry',
  staffCancelled: 'Invitation cancelled',
  staffError:
    'Could not finish staff setup. Refresh or retry the saved request.',
  staffFinishTitle: 'Finish staff setup',
  staffFinishHelp:
    'Your authenticator is verified. Finish the saved staff setup to activate the approved group role.',
  staffFinish: 'Finish staff setup',
} as const;
