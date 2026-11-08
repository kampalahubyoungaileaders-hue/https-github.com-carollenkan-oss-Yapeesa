import {
  money,
  finalShareOutCalcVersion,
  shareOutCommitJournal,
  shareOutPayoutJournal,
  type Journal,
} from '@yapesa/domain';
import { ApiError, object, textField } from './backend.js';
import { checkedShareOut } from './shareout.js';
function journal(actual: unknown, expected: Journal | null) {
  if (!Array.isArray(actual) || actual.length !== (expected?.lines.length ?? 0))
    throw new Error('Journal size mismatch');
  for (const line of expected?.lines ?? [])
    if (
      actual.filter((item) => {
        const row = object(item);
        return (
          row['account'] === line.account &&
          row['side'] === line.side &&
          row['amount'] === String(line.amount.minor)
        );
      }).length !== 1
    )
      throw new Error('Journal mismatch');
}
export function checkedFinalShareout(raw: unknown): unknown {
  try {
    const data = object(raw),
      currency = textField(data, 'currency');
    money(0n, currency);
    const readiness = object(data['readiness']);
    if (
      !Array.isArray(readiness['blockers']) ||
      readiness['blockers'].some((x) => typeof x !== 'string')
    )
      throw new Error('Missing prerequisites');
    function snapshot(value: unknown) {
      const s = object(value),
        p = object(checkedShareOut(s['preview']));
      if (p['currency'] !== currency) throw new Error('Currency mismatch');
      return { s, p };
    }
    if (readiness['snapshot']) snapshot(readiness['snapshot']);
    if (!data['plan']) return raw;
    const plan = object(data['plan']);
    if (plan['calc_version'] !== finalShareOutCalcVersion)
      throw new Error('Unsupported calculator');
    const { s, p } = snapshot(plan['snapshot']);
    if (p['cycle_id'] !== plan['cycle_id'] || p['loans_outstanding'] !== '0')
      throw new Error('Invalid cycle');
    if (
      money(BigInt(textField(s, 'cash')), currency).minor < 0n ||
      money(BigInt(textField(s, 'social')), currency).minor < 0n
    )
      throw new Error('Invalid reserve');
    const sources = ['capital', 'fines', 'interest'].map((key) =>
      money(BigInt(textField(s, key)), currency),
    );
    if (
      sources.some((x) => x.minor < 0n) ||
      sources.reduce((sum, x) => sum + x.minor, 0n) !==
        BigInt(textField(p, 'fund')) ||
      BigInt(textField(s, 'cash')) - BigInt(textField(s, 'social')) !==
        BigInt(textField(p, 'fund')) ||
      s['counted'] !== s['cash']
    )
      throw new Error('Source mismatch');
    if (
      !Array.isArray(plan['approvals']) ||
      !Array.isArray(plan['allocations'])
    )
      throw new Error('Missing records');
    const officers = plan['approvals'].map((x) =>
      textField(object(x), 'officer_id'),
    );
    if (new Set(officers).size !== officers.length)
      throw new Error('Duplicate approval');
    const committed = plan['committed'] === true;
    if (committed && officers.length < 2) throw new Error('Missing approvals');
    journal(
      plan['commit_journal'],
      committed
        ? shareOutCommitJournal('commit', sources[0]!, sources[1]!, sources[2]!)
        : null,
    );
    const expected = new Map(
      (p['members'] as unknown[]).map((item) => {
        const r = object(item);
        return [textField(r, 'id'), r];
      }),
    );
    const seen = new Set<string>();
    let pending = 0n;
    for (const item of plan['allocations']) {
      const a = object(item),
        id = textField(a, 'member_id'),
        e = expected.get(id);
      if (
        !committed ||
        !e ||
        seen.has(id) ||
        a['shares'] !== e['shares'] ||
        a['amount'] !== e['amount']
      )
        throw new Error('Allocation mismatch');
      seen.add(id);
      const amount = money(BigInt(textField(a, 'amount')), currency);
      if (a['receipt']) {
        const r = object(a['receipt']);
        if (r['amount'] !== a['amount']) throw new Error('Payout mismatch');
        journal(
          r['journal'],
          shareOutPayoutJournal(textField(r, 'journal_id'), amount),
        );
      } else pending += amount.minor;
    }
    if (
      (committed && seen.size !== expected.size) ||
      (plan['finalized'] === true && (!committed || pending !== 0n))
    )
      throw new Error('Incomplete distribution');
    return raw;
  } catch {
    throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
  }
}
