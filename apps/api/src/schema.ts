const string = { type: 'string' } as const;
const boolean = { type: 'boolean' } as const;
const uuid = { type: 'string', format: 'uuid' } as const;
const integerString = { type: 'string', pattern: '^[0-9]+$' } as const;
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
  members: { type: 'array', items: object({ id: uuid, name: string }) },
  transactions: {
    type: 'array',
    items: object({
      id: uuid,
      member_id: uuid,
      meeting_date: string,
      recorded_at: string,
      shares: integerString,
      amount: integerString,
      currency: string,
      journal_id: uuid,
      calculation_mismatch: boolean,
      note: string,
    }),
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
  amount: integerString,
  currency: string,
  calculation_mismatch: boolean,
  calc_version: string,
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
