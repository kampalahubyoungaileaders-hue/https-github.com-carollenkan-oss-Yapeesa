import {
  money,
  loanSchedule,
  loanCalcVersion,
  allocateLoanPayment,
  loanJournal,
  type LoanTerms,
  type LoanAllocation,
} from '@yapesa/domain';
import { ApiError, object, textField } from './backend.js';
function terms(raw: unknown, months: string): LoanTerms {
  const t = object(raw);
  if (BigInt(months) > BigInt(textField(t, 'max_months')))
    throw new Error('Term exceeds policy');
  return {
    months: BigInt(months),
    monthlyRateBps: BigInt(textField(t, 'monthly_rate_bps')),
    method: textField(t, 'method') as LoanTerms['method'],
    rounding: textField(t, 'rounding') as LoanTerms['rounding'],
    allocation: textField(t, 'allocation') as LoanTerms['allocation'],
    dates: textField(t, 'dates') as LoanTerms['dates'],
  };
}
function rows(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error('Missing loan rows');
  return raw.map((x: unknown) => object(x));
}
function allocation(
  raw: unknown,
  currency: string,
  sign = 1n,
): LoanAllocation[] {
  return rows(raw).map((r) => ({
    period: textField(r, 'period'),
    principal: money(sign * BigInt(textField(r, 'principal')), currency),
    interest: money(sign * BigInt(textField(r, 'interest')), currency),
  }));
}
function comparable(a: readonly LoanAllocation[]) {
  return a.map((r) => ({
    period: r.period,
    principal: String(r.principal.minor),
    interest: String(r.interest.minor),
  }));
}
function checkedSchedule(
  raw: unknown,
  principal: string,
  start: string,
  t: LoanTerms,
  currency: string,
) {
  const expected = loanSchedule(money(BigInt(principal), currency), start, t);
  const actual = rows(raw).map((r) => ({
    period: textField(r, 'period'),
    due: textField(r, 'due'),
    principal: textField(r, 'principal'),
    interest: textField(r, 'interest'),
  }));
  const normal = expected.map((r) => ({
    period: r.period,
    due: r.due,
    principal: String(r.principal.minor),
    interest: String(r.interest.minor),
  }));
  if (JSON.stringify(actual) !== JSON.stringify(normal))
    throw new Error('Loan schedule mismatch');
  return expected;
}
export function checkedLoanQuote(raw: unknown): unknown {
  try {
    const d = object(raw),
      currency = textField(d, 'currency');
    checkedSchedule(
      d['schedule'],
      textField(d, 'principal'),
      textField(d, 'start'),
      terms(d['terms'], textField(d, 'months')),
      currency,
    );
    for (const field of ['borrowable', 'available_cash'])
      if (money(BigInt(textField(d, field)), currency).minor < 0n)
        throw new Error('Invalid loan limit');
    return raw;
  } catch {
    throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
  }
}
export function checkedLoans(raw: unknown): unknown {
  try {
    const d = object(raw),
      currency = textField(d, 'currency');
    money(0n, currency);
    const requests = rows(d['requests']),
      events = rows(d['events']);
    const loanRows = rows(d['loans']);
    const ids = new Set<string>();
    for (const request of requests)
      loanSchedule(
        money(BigInt(textField(request, 'principal')), currency),
        textField(request, 'date'),
        terms(request['terms'], textField(request, 'months')),
      );
    const enriched = loanRows.map((book) => {
      const id = textField(book, 'id');
      if (ids.has(id)) throw new Error('Duplicate loan');
      ids.add(id);
      const request = requests.find((r) => r['id'] === book['request_id']);
      if (!request || book['calc_version'] !== loanCalcVersion)
        throw new Error('Unknown loan terms');
      const t = terms(request['terms'], textField(request, 'months'));
      const schedule = checkedSchedule(
        book['schedule'],
        textField(request, 'principal'),
        textField(book, 'date'),
        t,
        currency,
      );
      const posted = new Map<string, Record<string, unknown>>(),
        reversed = new Set<string>();
      const paid: LoanAllocation[] = [];
      let principalNet = 0n,
        interestPaid = 0n,
        disbursed = false,
        cancelled = false,
        last = 0n;
      for (const e of events.filter((e) => e['loan_id'] === id)) {
        const revision = BigInt(textField(e, 'revision'));
        if (revision <= last) throw new Error('Unordered loan events');
        last = revision;
        const eventId = textField(e, 'id');
        if (posted.has(eventId)) throw new Error('Duplicate loan event');
        const p = BigInt(textField(e, 'principal')),
          i = BigInt(textField(e, 'interest')),
          cash = BigInt(textField(e, 'cash'));
        if (cash !== p + i) throw new Error('Loan cash mismatch');
        const j = loanJournal(
          textField(e, 'journal_id'),
          money(p, currency),
          money(i, currency),
        );
        const lines = rows(e['journal']);
        if (lines.length !== j.lines.length)
          throw new Error('Missing loan journal');
        for (const l of j.lines)
          if (
            lines.filter(
              (a) =>
                a['account'] === l.account &&
                a['side'] === l.side &&
                a['amount'] === String(l.amount.minor),
            ).length !== 1
          )
            throw new Error('Loan journal mismatch');
        if (e['kind'] === 'disbursement') {
          if (
            disbursed ||
            cancelled ||
            p !== -BigInt(textField(request, 'principal')) ||
            i !== 0n ||
            rows(e['allocations']).length !== 0 ||
            e['reverses'] !== null
          )
            throw new Error('Invalid disbursement');
          disbursed = true;
        } else if (e['kind'] === 'repayment') {
          if (
            !disbursed ||
            cancelled ||
            p < 0n ||
            i < 0n ||
            e['reverses'] !== null
          )
            throw new Error('Invalid repayment');
          const expected = allocateLoanPayment(
            schedule,
            paid,
            money(cash, currency),
            t.allocation,
          );
          const actual = allocation(e['allocations'], currency);
          if (
            JSON.stringify(comparable(expected)) !==
              JSON.stringify(comparable(actual)) ||
            actual.reduce((sum, r) => sum + r.principal.minor, 0n) !== p ||
            actual.reduce((sum, r) => sum + r.interest.minor, 0n) !== i
          )
            throw new Error('Repayment allocation mismatch');
          paid.push(...actual);
          interestPaid += i;
        } else if (e['kind'] === 'reversal') {
          const target = textField(e, 'reverses'),
            original = posted.get(target);
          if (
            !original ||
            original['kind'] === 'reversal' ||
            reversed.has(target) ||
            p !== -BigInt(textField(original, 'principal')) ||
            i !== -BigInt(textField(original, 'interest')) ||
            JSON.stringify(e['allocations']) !==
              JSON.stringify(original['allocations'])
          )
            throw new Error('Invalid loan reversal');
          reversed.add(target);
          if (original['kind'] === 'disbursement') {
            if (
              principalNet !== -BigInt(textField(request, 'principal')) ||
              interestPaid !== 0n
            )
              throw new Error('Paid loan cannot be undone');
            cancelled = true;
          } else {
            paid.push(...allocation(e['allocations'], currency, -1n));
            interestPaid += i;
          }
        } else throw new Error('Unknown loan event');
        principalNet += p;
        posted.set(eventId, e);
      }
      if (!disbursed) throw new Error('Missing disbursement');
      const principalRemaining = -principalNet,
        interestRemaining = cancelled
          ? 0n
          : schedule.reduce((sum, r) => sum + r.interest.minor, 0n) -
            interestPaid;
      if (principalRemaining < 0n || interestRemaining < 0n)
        throw new Error('Loan overpaid');
      money(principalRemaining, currency);
      money(interestRemaining, currency);
      return {
        ...book,
        principal_remaining: String(principalRemaining),
        interest_remaining: String(interestRemaining),
        cancelled,
      };
    });
    if (events.some((e) => !ids.has(textField(e, 'loan_id'))))
      throw new Error('Unknown loan event');
    return { ...d, loans: enriched };
  } catch {
    throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
  }
}
