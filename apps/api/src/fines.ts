import { money, fineJournal, fineOutstanding } from '@yapesa/domain';
import { ApiError, object, textField } from './backend.js';
export function checkedFines(raw: unknown): unknown {
  try {
    const data = object(raw);
    const currency = textField(data, 'currency');
    money(0n, currency);
    if (!Array.isArray(data['charges']) || !Array.isArray(data['events']))
      throw new Error('Missing fine records');
    const totals = new Map<string, { paid: bigint; waived: bigint }>();
    for (const item of data['events']) {
      const row = object(item);
      const cash = BigInt(textField(row, 'cash'));
      const waived = BigInt(textField(row, 'waived'));
      const kind = textField(row, 'kind');
      if (kind === 'waiver') {
        if (
          cash !== 0n ||
          waived <= 0n ||
          row['journal_id'] !== null ||
          !Array.isArray(row['journal']) ||
          row['journal'].length !== 0
        )
          throw new Error('Invalid waiver');
      } else {
        if (
          (kind !== 'payment' && kind !== 'reversal') ||
          (kind === 'payment' ? cash <= 0n : cash >= 0n) ||
          waived !== 0n
        )
          throw new Error('Invalid receipt');
        const expected = fineJournal(
          textField(row, 'journal_id'),
          money(cash, currency),
        );
        if (!Array.isArray(row['journal']) || row['journal'].length !== 2)
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
      }
      const id = textField(row, 'charge_id');
      const total = totals.get(id) ?? { paid: 0n, waived: 0n };
      total.paid += cash;
      total.waived += waived;
      totals.set(id, total);
    }
    const seen = new Set<string>();
    for (const item of data['charges']) {
      const row = object(item);
      const id = textField(row, 'id');
      if (seen.has(id)) throw new Error('Duplicate charge');
      seen.add(id);
      const total = totals.get(id) ?? { paid: 0n, waived: 0n };
      const due = fineOutstanding(
        money(BigInt(textField(row, 'amount')), currency),
        money(total.paid, currency),
        money(total.waived, currency),
      );
      if (
        String(due.minor) !== textField(row, 'due') ||
        String(total.paid) !== textField(row, 'paid') ||
        String(total.waived) !== textField(row, 'waived')
      )
        throw new Error('Fine balance mismatch');
    }
    if ([...totals.keys()].some((id) => !seen.has(id)))
      throw new Error('Missing charge');
    return raw;
  } catch {
    throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
  }
}
