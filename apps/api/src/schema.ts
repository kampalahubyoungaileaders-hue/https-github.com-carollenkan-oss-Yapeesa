const string = { type: 'string' } as const;
const boolean = { type: 'boolean' } as const;
const uuid = { type: 'string', format: 'uuid' } as const;
const integerString = { type: 'string', pattern: '^[0-9]+$' } as const;
const signedIntegerString = { type: 'string', pattern: '^-?[0-9]+$' } as const;
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: 'object', additionalProperties: false, properties, required });
export const sessionSchema = object({
  configured: boolean,
  user: {
    anyOf: [
      { type: 'null' },
      object(
        {
          person_id: uuid,
          display_name: string,
          requires_mfa: boolean,
          mfa_verified: boolean,
          can_administer: boolean,
          activation_pending: boolean,
          factors: { type: 'array', items: object({ id: uuid, name: string }) },
        },
        [
          'person_id',
          'display_name',
          'requires_mfa',
          'mfa_verified',
          'can_administer',
          'factors',
        ],
      ),
    ],
  },
});
export const groupSchema = object({
  id: uuid,
  name: string,
  currency: string,
  time_zone: string,
  country_code: string,
  minor_digits: { type: 'integer', minimum: 0, maximum: 4 },
  can_record: boolean,
});
export const workspaceSchema = object({
  meeting_count: integerString,
  group: object({
    ...groupSchema.properties,
    max_shares: integerString,
    can_preview_shareout: boolean,
  }),
  cycle: {
    anyOf: [
      { type: 'null' },
      object({
        id: uuid,
        starts_on: string,
        ends_on: string,
        share_price: integerString,
      }),
    ],
  },
  members: {
    type: 'array',
    items: object({ id: uuid, name: string, active: boolean }),
  },
  transactions: {
    type: 'array',
    items: object(
      {
        id: uuid,
        member_id: uuid,
        meeting_date: string,
        recorded_at: string,
        shares: signedIntegerString,
        amount: signedIntegerString,
        currency: string,
        journal_id: uuid,
        calculation_mismatch: boolean,
        note: string,
        reverses: { anyOf: [uuid, { type: 'null' }] },
      },
      [
        'id',
        'member_id',
        'meeting_date',
        'recorded_at',
        'shares',
        'amount',
        'currency',
        'journal_id',
        'calculation_mismatch',
        'note',
      ],
    ),
  },
  journal_lines: {
    type: 'array',
    items: object({
      journal_id: uuid,
      account: {
        type: 'string',
        enum: ['cash', 'share_capital', 'social_fund'],
      },
      side: { type: 'string', enum: ['debit', 'credit'] },
      amount: integerString,
    }),
  },
});
export const purchaseBody = object({
  member_id: uuid,
  meeting_date: { type: 'string', format: 'date' },
  shares: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
  client_id: {
    type: 'string',
    pattern:
      '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',
  },
  device_id: uuid,
  client_amount: integerString,
  client_calc_version: { type: 'string', minLength: 1, maxLength: 64 },
  note: { type: 'string', maxLength: 240 },
});
export const receiptSchema = object({
  transaction_id: uuid,
  journal_id: uuid,
  client_id: uuid,
  amount: signedIntegerString,
  currency: string,
  calculation_mismatch: boolean,
  calc_version: string,
});
export const reversalBody = object({
  transaction_id: uuid,
  client_id: purchaseBody.properties.client_id,
  device_id: uuid,
  reason: { type: 'string', minLength: 1, maxLength: 240, pattern: '\\S' },
});
export const factorSchema = object({ id: uuid, secret: string, uri: string });
export const shareoutSchema = object({
  cycle_id: uuid,
  currency: string,
  fund: integerString,
  total_shares: integerString,
  calc_version: string,
  loans_outstanding: integerString,
  scope: {
    type: 'string',
    enum: [
      'recorded-shares-only',
      'recorded-shares-and-paid-fines',
      'recorded-shares-fines-and-loan-interest',
    ],
  },
  members: {
    type: 'array',
    items: object({
      id: uuid,
      name: string,
      shares: integerString,
      amount: integerString,
    }),
  },
});
export const errorSchema = object({ error: string });
export const phonePinBody = object({
  phone: { type: 'string', pattern: '^\\+[1-9][0-9]{6,14}$' },
  pin: { type: 'string', pattern: '^[0-9]{6}$' },
});
export const mfaBody = object({
  factor_id: uuid,
  code: { type: 'string', pattern: '^[0-9]{6}$' },
});
export const invitationPhoneBody = object({
  phone: phonePinBody.properties.phone,
});
export const invitationBody = object({
  ...phonePinBody.properties,
  code: { type: 'string', pattern: '^[0-9]{6}$' },
});
export const recoveryCodeBody = object({
  phone: phonePinBody.properties.phone,
  code: mfaBody.properties.code,
});
export const recoveryPinBody = object({ pin: phonePinBody.properties.pin });
export const recoverySchema = object({
  requires_mfa: boolean,
  mfa_verified: boolean,
  factors: { type: 'array', items: object({ id: uuid, name: string }) },
});
export const recoveryResultSchema = object({
  ok: boolean,
  cleanup_complete: boolean,
});
const nullableUuid = { anyOf: [uuid, { type: 'null' }] };
const adminCycle = object({
  starts_on: { type: 'string', format: 'date' },
  ends_on: { type: 'string', format: 'date' },
  share_price: integerString,
});
export const adminWorkspaceSchema = object({
  currencies: {
    type: 'array',
    items: object({
      code: string,
      minor_digits: { type: 'integer', minimum: 0, maximum: 4 },
    }),
  },
  people: {
    type: 'array',
    items: object({
      id: uuid,
      name: string,
      phone: { anyOf: [string, { type: 'null' }] },
      has_login: boolean,
      staff_ready: boolean,
    }),
  },
  groups: {
    type: 'array',
    items: object({
      id: uuid,
      name: string,
      country_code: string,
      currency: string,
      time_zone: string,
      max_shares: integerString,
      next_cycle: {
        anyOf: [
          { type: 'null' },
          object({
            previous_cycle_id: uuid,
            finalization_id: uuid,
            earliest_start: { type: 'string', format: 'date' },
            cash: integerString,
            social: integerString,
          }),
        ],
      },
      configuration_locked: boolean,
      cycle: { anyOf: [adminCycle, { type: 'null' }] },
      memberships: {
        type: 'array',
        items: object({ person_id: uuid, role: string }),
      },
    }),
  },
});
export const adminResultSchema = object({ id: uuid });
const command = { request_id: uuid, device_id: uuid };
const configuration = {
  name: { type: 'string', minLength: 1, maxLength: 200 },
  max_shares: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
  starts_on: { type: 'string', format: 'date' },
  ends_on: { type: 'string', format: 'date' },
  share_price: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
};
export const adminGroupBody = object({
  ...command,
  ...configuration,
  country_code: { type: 'string', pattern: '^[A-Z]{2}$' },
  currency: { type: 'string', pattern: '^[A-Z]{3}$' },
  time_zone: { type: 'string', minLength: 1, maxLength: 100 },
});
export const adminConfigurationBody = object({ ...command, ...configuration });
export const adminMemberBody = object({
  ...command,
  existing_person: nullableUuid,
  name: { type: 'string', maxLength: 150 },
  phone: { anyOf: [phonePinBody.properties.phone, { type: 'null' }] },
});
export const adminRoleBody = object({
  ...command,
  person_id: uuid,
  role: { type: 'string', enum: ['member', 'secretary', 'treasurer', 'chair'] },
  enabled: boolean,
});
export const socialRuleBody = object({
  request_id: purchaseBody.properties.client_id,
  device_id: uuid,
  amount: {
    anyOf: [
      { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
      { type: 'null' },
    ],
  },
  roles: {
    type: 'array',
    uniqueItems: true,
    maxItems: 3,
    items: { type: 'string', enum: ['secretary', 'treasurer', 'chair'] },
  },
  separate: boolean,
  require_all: boolean,
});
export const socialCommandBody = object({
  request_id: purchaseBody.properties.client_id,
  device_id: uuid,
  action: {
    type: 'string',
    enum: ['start', 'contribute', 'grant', 'reverse', 'approve', 'cancel'],
  },
  meeting_id: nullableUuid,
  member_id: nullableUuid,
  target_id: nullableUuid,
  amount: {
    anyOf: [
      { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
      { type: 'null' },
    ],
  },
  reason: { type: 'string', maxLength: 240 },
});
export const socialWorkspaceSchema = object({
  can_record: boolean,
  can_configure: boolean,
  currency: string,
  balance: { anyOf: [integerString, { type: 'null' }] },
  rule: {
    anyOf: [
      { type: 'null' },
      object({
        id: uuid,
        contribution: integerString,
        roles: { type: 'array', items: string },
        separate: boolean,
        require_all: boolean,
      }),
    ],
  },
  meetings: {
    type: 'array',
    items: object({
      id: uuid,
      date: string,
      status: { type: 'string', enum: ['open', 'closed'] },
      ready: boolean,
      contribution: { anyOf: [integerString, { type: 'null' }] },
      roles: { type: 'array', items: string },
      separate: { anyOf: [boolean, { type: 'null' }] },
      require_all: { anyOf: [boolean, { type: 'null' }] },
      started: boolean,
    }),
  },
  transactions: {
    type: 'array',
    items: object({
      id: uuid,
      meeting_id: uuid,
      date: string,
      member_id: uuid,
      name: string,
      kind: { type: 'string', enum: ['contribution', 'grant', 'reversal'] },
      cash: signedIntegerString,
      reverses: nullableUuid,
      journal_id: uuid,
      note: string,
      recorded_at: string,
      journal: {
        type: 'array',
        items: object({
          account: { type: 'string', enum: ['cash', 'social_fund'] },
          side: { type: 'string', enum: ['debit', 'credit'] },
          amount: integerString,
        }),
      },
    }),
  },
  requests: {
    type: 'array',
    items: object({
      id: uuid,
      meeting_id: uuid,
      date: string,
      name: string,
      kind: { type: 'string', enum: ['grant', 'reversal'] },
      cash: signedIntegerString,
      reason: string,
      entered_by: uuid,
      outcome: {
        anyOf: [
          { type: 'string', enum: ['approved', 'cancelled'] },
          { type: 'null' },
        ],
      },
      can_approve: boolean,
    }),
  },
});
export const meetingCommandBody = object({
  request_id: purchaseBody.properties.client_id,
  device_id: uuid,
  action: {
    type: 'string',
    enum: ['open', 'attendance', 'propose', 'approve'],
  },
  date: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
  meeting_id: nullableUuid,
  member_id: nullableUuid,
  status: {
    anyOf: [
      { type: 'string', enum: ['present', 'absent', 'excused'] },
      { type: 'null' },
    ],
  },
  counted_cash: {
    anyOf: [
      { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' },
      { type: 'null' },
    ],
  },
  explanation: {
    anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }],
  },
  proposal_id: nullableUuid,
});
const nullableString = { anyOf: [string, { type: 'null' }] };
export const meetingWorkspaceSchema = object({
  can_approve: boolean,
  currency: string,
  can_record: boolean,
  meetings: {
    type: 'array',
    items: object({
      id: uuid,
      date: string,
      status: { type: 'string', enum: ['open', 'closed'] },
      opening_cash: nullableString,
      cash_in: nullableString,
      cash_out: nullableString,
      expected_cash: nullableString,
      roster: {
        type: 'array',
        items: object({
          id: uuid,
          name: string,
          status: {
            anyOf: [
              { type: 'string', enum: ['present', 'absent', 'excused'] },
              { type: 'null' },
            ],
          },
        }),
      },
      proposal: {
        anyOf: [
          { type: 'null' },
          object({
            id: uuid,
            expected_cash: string,
            counted_cash: string,
            difference: string,
            explanation: string,
            stale: boolean,
            approvals: {
              type: 'array',
              items: object({
                person_id: uuid,
                name: string,
                eligible: boolean,
              }),
            },
          }),
        ],
      },
    }),
  },
});
export const fineRuleSchema = object({
  code: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,39}$' },
  name: { type: 'string', minLength: 1, maxLength: 80 },
  amount: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
  trigger: { type: 'string', enum: ['manual', 'absence'] },
  partial: boolean,
});
export const finePolicyBody = object({
  request_id: purchaseBody.properties.client_id,
  device_id: uuid,
  rules: { type: 'array', maxItems: 20, items: fineRuleSchema },
});
export const fineCommandBody = object({
  request_id: purchaseBody.properties.client_id,
  device_id: uuid,
  action: { type: 'string', enum: ['assess', 'pay', 'waive', 'reverse'] },
  meeting_id: uuid,
  member_id: nullableUuid,
  target_id: nullableUuid,
  code: { anyOf: [string, { type: 'null' }] },
  amount: {
    anyOf: [
      { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
      { type: 'null' },
    ],
  },
  reason: { type: 'string', minLength: 1, maxLength: 240 },
});
export const fineWorkspaceSchema = object({
  can_record: boolean,
  can_configure: boolean,
  currency: string,
  rules: { type: 'array', items: fineRuleSchema },
  meetings: {
    type: 'array',
    items: object({
      id: uuid,
      date: string,
      status: { type: 'string', enum: ['open', 'closed'] },
      ready: boolean,
      rules: { type: 'array', items: fineRuleSchema },
    }),
  },
  charges: {
    type: 'array',
    items: object({
      id: uuid,
      meeting_id: uuid,
      date: string,
      member_id: uuid,
      name: string,
      fine: string,
      amount: integerString,
      partial: boolean,
      paid: integerString,
      waived: integerString,
      due: integerString,
      reason: string,
      automatic: boolean,
    }),
  },
  events: {
    type: 'array',
    items: object({
      id: uuid,
      meeting_id: uuid,
      date: string,
      charge_id: uuid,
      name: string,
      kind: { type: 'string', enum: ['payment', 'reversal', 'waiver'] },
      cash: signedIntegerString,
      waived: integerString,
      reverses: nullableUuid,
      reason: string,
      journal_id: nullableUuid,
      journal: {
        type: 'array',
        items: object({
          account: string,
          side: { type: 'string', enum: ['debit', 'credit'] },
          amount: integerString,
        }),
      },
    }),
  },
});
export const loanTermsSchema = object({
  monthly_rate_bps: integerString,
  method: { type: 'string', enum: ['flat', 'declining'] },
  multiple: integerString,
  max_months: integerString,
  rounding: { type: 'string', enum: ['half_up', 'down'] },
  allocation: { type: 'string', enum: ['interest_first', 'principal_first'] },
  dates: { type: 'string', enum: ['original_day', 'month_end'] },
  roles: {
    type: 'array',
    minItems: 1,
    maxItems: 3,
    uniqueItems: true,
    items: { type: 'string', enum: ['secretary', 'treasurer', 'chair'] },
  },
  separate: boolean,
  approvals: { type: 'string', enum: ['1', '2', '3'] },
});
const loanInstalmentSchema = object({
  period: integerString,
  due: string,
  principal: integerString,
  interest: integerString,
});
const loanAllocationSchema = object({
  period: integerString,
  principal: integerString,
  interest: integerString,
});
export const loanPolicyBody = object({
  request_id: purchaseBody.properties.client_id,
  device_id: uuid,
  policy: { anyOf: [loanTermsSchema, { type: 'null' }] },
});
export const loanQuoteBody = object({
  member_id: uuid,
  meeting_id: uuid,
  principal: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
  months: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' },
});
export const loanQuoteSchema = object({
  policy_id: uuid,
  terms: loanTermsSchema,
  currency: string,
  start: string,
  principal: integerString,
  months: integerString,
  schedule: { type: 'array', items: loanInstalmentSchema },
  borrowable: integerString,
  available_cash: integerString,
});
const loanCommandProperties = {
  request_id: purchaseBody.properties.client_id,
  device_id: uuid,
  action: {
    type: 'string',
    enum: ['request', 'approve', 'cancel', 'disburse', 'repay', 'reverse'],
  },
  meeting_id: uuid,
  member_id: nullableUuid,
  target_id: nullableUuid,
  policy_id: nullableUuid,
  amount: {
    anyOf: [
      { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
      { type: 'null' },
    ],
  },
  months: {
    anyOf: [{ type: 'string', pattern: '^[1-9][0-9]{0,2}$' }, { type: 'null' }],
  },
  reason: { type: 'string', maxLength: 240 },
  calculation: {
    anyOf: [
      object({
        calc_version: { type: 'string', minLength: 1, maxLength: 64 },
        principal: signedIntegerString,
        interest: signedIntegerString,
      }),
      { type: 'null' },
    ],
  },
};
export const loanCommandBody = object(
  loanCommandProperties,
  Object.keys(loanCommandProperties).filter((key) => key !== 'calculation'),
);
export const loanWorkspaceSchema = object({
  currency: string,
  can_record: boolean,
  can_configure: boolean,
  policy: {
    anyOf: [object({ id: uuid, terms: loanTermsSchema }), { type: 'null' }],
  },
  meetings: {
    type: 'array',
    items: object({
      id: uuid,
      date: string,
      status: { type: 'string', enum: ['open', 'closed'] },
      ready: boolean,
      available_cash: { anyOf: [integerString, { type: 'null' }] },
    }),
  },
  requests: {
    type: 'array',
    items: object({
      id: uuid,
      meeting_id: uuid,
      member_id: uuid,
      name: string,
      principal: integerString,
      months: integerString,
      policy_id: uuid,
      terms: loanTermsSchema,
      calculation_mismatch: boolean,
      reason: string,
      entered_by: uuid,
      date: string,
      cancelled: boolean,
      loan_id: nullableUuid,
      can_approve: boolean,
      approvals: {
        type: 'array',
        items: object({ person_id: uuid, eligible: boolean }),
      },
    }),
  },
  loans: {
    type: 'array',
    items: object({
      id: uuid,
      request_id: uuid,
      meeting_id: uuid,
      member_id: uuid,
      name: string,
      date: string,
      schedule: { type: 'array', items: loanInstalmentSchema },
      calc_version: string,
      principal_remaining: integerString,
      interest_remaining: integerString,
      cancelled: boolean,
    }),
  },
  events: {
    type: 'array',
    items: object({
      id: uuid,
      revision: integerString,
      loan_id: uuid,
      meeting_id: uuid,
      date: string,
      kind: { type: 'string', enum: ['disbursement', 'repayment', 'reversal'] },
      principal: signedIntegerString,
      interest: signedIntegerString,
      cash: signedIntegerString,
      allocations: { type: 'array', items: loanAllocationSchema },
      reverses: nullableUuid,
      journal_id: uuid,
      calculation_mismatch: boolean,
      reason: string,
      journal: {
        type: 'array',
        items: object({
          account: string,
          side: { type: 'string', enum: ['debit', 'credit'] },
          amount: integerString,
        }),
      },
    }),
  },
});

const shareoutSnapshotSchema = object({
  preview: shareoutSchema,
  cash: signedIntegerString,
  social: signedIntegerString,
  capital: signedIntegerString,
  fines: signedIntegerString,
  interest: signedIntegerString,
  meeting_id: { anyOf: [uuid, { type: 'null' }] },
  closing_id: { anyOf: [uuid, { type: 'null' }] },
  counted: { anyOf: [integerString, { type: 'null' }] },
});
const shareoutJournalSchema = {
  type: 'array',
  items: object({
    account: string,
    side: { type: 'string', enum: ['debit', 'credit'] },
    amount: integerString,
  }),
};
export const finalShareoutSchema = object({
  can_approve: boolean,
  currency: string,
  can_record: boolean,
  actor_id: uuid,
  readiness: object({
    blockers: { type: 'array', items: string },
    snapshot: { anyOf: [shareoutSnapshotSchema, { type: 'null' }] },
  }),
  plan: {
    anyOf: [
      { type: 'null' },
      object({
        id: uuid,
        cycle_id: uuid,
        snapshot: shareoutSnapshotSchema,
        snapshot_hash: string,
        calc_version: string,
        entered_by: uuid,
        recorded_at: string,
        current: boolean,
        committed: boolean,
        finalized: boolean,
        approvals: {
          type: 'array',
          items: object({
            officer_id: uuid,
            eligible: boolean,
            recorded_at: string,
          }),
        },
        commit_journal: shareoutJournalSchema,
        allocations: {
          type: 'array',
          items: object({
            id: uuid,
            member_id: uuid,
            name: string,
            shares: integerString,
            amount: integerString,
            receipt: {
              anyOf: [
                { type: 'null' },
                object({
                  id: uuid,
                  amount: integerString,
                  reason: string,
                  recorded_at: string,
                  entered_by: uuid,
                  journal_id: uuid,
                  journal: shareoutJournalSchema,
                }),
              ],
            },
          }),
        },
      }),
    ],
  },
});
export const finalShareoutBody = object({
  request_id: uuid,
  device_id: uuid,
  action: { type: 'string', enum: ['prepare', 'approve', 'pay', 'finish'] },
  plan_id: { anyOf: [uuid, { type: 'null' }] },
  allocation_id: { anyOf: [uuid, { type: 'null' }] },
  reason: { type: 'string', maxLength: 240 },
  confirmed: { type: 'boolean', const: true },
});

export const adminNewCycleBody = object({
  ...command,
  starts_on: { type: 'string', format: 'date' },
  ends_on: { type: 'string', format: 'date' },
  share_price: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
});

const reviewOutcome = {
  type: 'string',
  enum: ['confirmed', 'correction_required'],
};
const reviewSourceType = {
  type: 'string',
  enum: [
    'share_calculation',
    'loan_calculation',
    'meeting',
    'journal',
    'shareout',
  ],
};
export const reviewWorkspaceSchema = object({
  actor_id: uuid,
  can_decide: boolean,
  mismatches: {
    type: 'array',
    items: object({
      type: reviewSourceType,
      id: uuid,
      member_id: uuid,
      name: string,
      recorded_at: string,
      review_id: nullableUuid,
    }),
  },
  closed_sources: {
    type: 'array',
    items: object({ type: reviewSourceType, id: uuid, date: string }),
  },
  reviews: {
    type: 'array',
    items: object({
      id: uuid,
      kind: { type: 'string', enum: ['calculation', 'closed_record'] },
      source_type: reviewSourceType,
      source_id: uuid,
      source: { type: 'object', additionalProperties: true },
      reason: string,
      entered_by: uuid,
      recorded_at: string,
      proposal: {
        anyOf: [
          { type: 'null' },
          object({
            id: uuid,
            outcome: reviewOutcome,
            reason: string,
            entered_by: uuid,
            recorded_at: string,
            approvals: {
              type: 'array',
              items: object({
                officer_id: uuid,
                eligible: boolean,
                recorded_at: string,
              }),
            },
          }),
        ],
      },
      resolution: {
        anyOf: [
          { type: 'null' },
          object({
            outcome: reviewOutcome,
            recorded_at: string,
            proposal_id: uuid,
          }),
        ],
      },
    }),
  },
});
export const reviewCommandBody = object({
  ...command,
  action: { type: 'string', enum: ['open', 'propose', 'approve'] },
  kind: {
    anyOf: [
      { type: 'null' },
      { type: 'string', enum: ['calculation', 'closed_record'] },
    ],
  },
  source_type: { anyOf: [{ type: 'null' }, reviewSourceType] },
  source_id: nullableUuid,
  review_id: nullableUuid,
  proposal_id: nullableUuid,
  outcome: { anyOf: [{ type: 'null' }, reviewOutcome] },
  reason: { type: 'string', maxLength: 500 },
});

export const staffInviteBody = object({
  request_id: uuid,
  organisation_id: uuid,
  person_id: nullableUuid,
  name: { type: 'string', maxLength: 150 },
  phone: { type: 'string', pattern: '^\\+[1-9][0-9]{6,14}$' },
  email: { type: 'string', format: 'email', maxLength: 254 },
  role: { type: 'string', enum: ['secretary', 'treasurer', 'chair'] },
  reason: { type: 'string', minLength: 1, maxLength: 500 },
});
export const staffWorkspaceSchema = object({
  invitations: {
    type: 'array',
    items: object({
      id: uuid,
      organisation_id: uuid,
      person_id: uuid,
      name: string,
      phone: string,
      email: { type: 'string', format: 'email', maxLength: 254 },
      role: { type: 'string', enum: ['secretary', 'treasurer', 'chair'] },
      recorded_at: string,
      reason: string,
      account_created: boolean,
      activated: boolean,
      cancelled: boolean,
    }),
  },
});
