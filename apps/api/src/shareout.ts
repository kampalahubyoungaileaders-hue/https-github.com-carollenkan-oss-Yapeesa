import { money, shareOut, shareOutCalcVersion } from '@yapesa/domain';
import { ApiError, object, textField } from './backend.js';

// The SQL allocation and shared domain calculator must agree before display.
export function checkedShareOut(raw: unknown): unknown {
  try {
    const data = object(raw);
    if (
      textField(data, 'calc_version') !== shareOutCalcVersion ||
      data['scope'] !== 'recorded-shares-only' ||
      !Array.isArray(data['members'])
    )
      throw new Error('Invalid preview');
    const rows = data['members'].map((item: unknown) => {
      const row = object(item);
      const shares = textField(row, 'shares');
      const amount = textField(row, 'amount');
      if (
        !/^(0|[1-9][0-9]*)$/.test(shares) ||
        !/^(0|[1-9][0-9]*)$/.test(amount)
      )
        throw new Error('Invalid integer');
      return { id: textField(row, 'id'), shares: BigInt(shares), amount };
    });
    const fund = textField(data, 'fund');
    if (!/^(0|[1-9][0-9]*)$/.test(fund)) throw new Error('Invalid fund');
    const expected = shareOut(
      money(BigInt(fund), textField(data, 'currency')),
      rows,
    );
    const actual = new Map(rows.map((row) => [row.id, row.amount]));
    if (
      expected.some((row) => String(row.amount.minor) !== actual.get(row.id)) ||
      String(rows.reduce((sum, row) => sum + row.shares, 0n)) !==
        textField(data, 'total_shares')
    )
      throw new Error('Calculation mismatch');
    return raw;
  } catch {
    throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
  }
}
