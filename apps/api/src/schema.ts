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
      object({
        person_id: uuid,
        display_name: string,
        requires_mfa: boolean,
        mfa_verified: boolean,
        can_administer: boolean,
        factors: { type: 'array', items: object({ id: uuid, name: string }) },
      }),
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
  group: object({ ...groupSchema.properties, max_shares: integerString }),
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
      account: { type: 'string', enum: ['cash', 'share_capital'] },
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
