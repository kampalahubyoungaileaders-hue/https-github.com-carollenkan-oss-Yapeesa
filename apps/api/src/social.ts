import { money, socialJournal } from '@yapesa/domain';
import { ApiError, object, textField } from './backend.js';
export function checkedSocial(raw: unknown): unknown {
  try {
    const data = object(raw);
    const currency = textField(data, 'currency');
    money(0n, currency);
    if (!Array.isArray(data['transactions']))
      throw new Error('Invalid social rows');
    let total = 0n;
    for (const item of data['transactions']) {
      const row = object(item);
      const signed = BigInt(textField(row, 'cash'));
      const expected = socialJournal(
        textField(row, 'journal_id'),
        money(signed, currency),
      );
      if (
        !Array.isArray(row['journal']) ||
        row['journal'].length !== expected.lines.length
      )
        throw new Error('Missing journal');
      const lines = row['journal'].map((item: unknown) => object(item));
      for (const line of expected.lines)
        if (
          lines.filter(
            (actual) =>
              actual['account'] === line.account &&
              actual['side'] === line.side &&
              actual['amount'] === String(line.amount.minor),
          ).length !== 1
        )
          throw new Error('Journal mismatch');
      total += signed;
    }
    if (data['balance'] !== null && total < 0n)
      throw new Error('Negative fund');
    if (
      data['balance'] !== null &&
      textField(data, 'balance') !== String(total)
    )
      throw new Error('Fund mismatch');
    return raw;
  } catch {
    throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
  }
}
