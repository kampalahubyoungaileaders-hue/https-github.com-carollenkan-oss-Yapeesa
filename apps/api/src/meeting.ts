import { money, reconcileCash } from '@yapesa/domain';
import { ApiError, object, textField } from './backend.js';
export function checkedMeetings(raw: unknown): unknown {
  try {
    const data = object(raw);
    const currency = textField(data, 'currency');
    money(0n, currency);
    if (!Array.isArray(data['meetings'])) throw new Error('Invalid meetings');
    for (const item of data['meetings']) {
      const row = object(item);
      if (row['opening_cash'] === null) continue;
      const opening = money(BigInt(textField(row, 'opening_cash')), currency);
      const income = money(BigInt(textField(row, 'cash_in')), currency);
      const out = money(BigInt(textField(row, 'cash_out')), currency);
      const expected = reconcileCash(opening, income, out, money(0n, currency))
        .expected.minor;
      if (String(expected) !== textField(row, 'expected_cash'))
        throw new Error('Cash mismatch');
      if (row['proposal']) {
        const proposal = object(row['proposal']);
        const difference = reconcileCash(
          money(BigInt(textField(proposal, 'expected_cash')), currency),
          money(0n, currency),
          money(0n, currency),
          money(BigInt(textField(proposal, 'counted_cash')), currency),
        ).difference.minor;
        if (String(difference) !== textField(proposal, 'difference'))
          throw new Error('Count mismatch');
      }
    }
    return raw;
  } catch {
    throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
  }
}
