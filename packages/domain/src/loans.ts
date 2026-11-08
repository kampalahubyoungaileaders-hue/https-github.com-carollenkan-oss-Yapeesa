import { money, type Money, type Journal, type JournalLine } from './index.js';
export const loanCalcVersion = 'groups-loans-v1';
export type LoanTerms = Readonly<{
  monthlyRateBps: bigint;
  months: bigint;
  method: 'flat' | 'declining';
  rounding: 'half_up' | 'down';
  allocation: 'interest_first' | 'principal_first';
  dates: 'original_day' | 'month_end';
}>;
export type Instalment = Readonly<{
  period: string;
  due: string;
  principal: Money;
  interest: Money;
}>;
export type LoanAllocation = Readonly<{
  period: string;
  principal: Money;
  interest: Money;
}>;
function monthDays(year: bigint, month: bigint): bigint {
  if (month === 2n)
    return year % 400n === 0n || (year % 4n === 0n && year % 100n !== 0n)
      ? 29n
      : 28n;
  return [4n, 6n, 9n, 11n].includes(month) ? 30n : 31n;
}
function dateParts(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid loan date');
  const [y, m, d] = value.split('-');
  if (!y || !m || !d) throw new Error('Invalid loan date');
  const year = BigInt(y),
    month = BigInt(m),
    day = BigInt(d);
  if (
    year < 1n ||
    year > 9999n ||
    month < 1n ||
    month > 12n ||
    day < 1n ||
    day > monthDays(year, month)
  )
    throw new Error('Invalid loan date');
  return { year, month, day };
}
export function loanDueDate(
  start: string,
  period: bigint,
  rule: LoanTerms['dates'],
): string {
  const { year, month, day } = dateParts(start);
  if (
    typeof period !== 'bigint' ||
    period < 1n ||
    period > 120n ||
    !['original_day', 'month_end'].includes(rule)
  )
    throw new Error('Invalid loan period');
  const shifted = month - 1n + period;
  const targetYear = year + shifted / 12n,
    targetMonth = (shifted % 12n) + 1n;
  if (targetYear > 9999n) throw new Error('Loan date overflow');
  const last = monthDays(targetYear, targetMonth);
  const targetDay = rule === 'month_end' || day > last ? last : day;
  return `${String(targetYear).padStart('0000'.length, '0')}-${String(targetMonth).padStart('00'.length, '0')}-${String(targetDay).padStart('00'.length, '0')}`;
}
export function loanSchedule(
  principal: Money,
  start: string,
  terms: LoanTerms,
): readonly Instalment[] {
  money(principal.minor, principal.currency);
  dateParts(start);
  if (
    principal.minor <= 0n ||
    typeof terms.months !== 'bigint' ||
    terms.months < 1n ||
    terms.months > 120n ||
    typeof terms.monthlyRateBps !== 'bigint' ||
    terms.monthlyRateBps < 0n ||
    terms.monthlyRateBps > 1000000n ||
    !['flat', 'declining'].includes(terms.method) ||
    !['down', 'half_up'].includes(terms.rounding) ||
    !['interest_first', 'principal_first'].includes(terms.allocation) ||
    !['original_day', 'month_end'].includes(terms.dates)
  )
    throw new Error('Invalid loan terms');
  if (principal.minor < terms.months)
    throw new Error('Principal must cover each instalment');
  const base = principal.minor / terms.months;
  let rawTotal = 0n;
  for (let period = 1n; period <= terms.months; period++)
    rawTotal +=
      (terms.method === 'flat'
        ? principal.minor
        : principal.minor - base * (period - 1n)) * terms.monthlyRateBps;
  const totalInterest =
    (rawTotal + (terms.rounding === 'half_up' ? 5000n : 0n)) / 10000n;
  money(principal.minor + totalInterest, principal.currency);
  let assignedInterest = 0n;
  const rows: Instalment[] = [];
  for (let period = 1n; period <= terms.months; period++) {
    const part =
      period === terms.months ? principal.minor - base * (period - 1n) : base;
    const interest =
      period === terms.months
        ? totalInterest - assignedInterest
        : ((terms.method === 'flat'
            ? principal.minor
            : principal.minor - base * (period - 1n)) *
            terms.monthlyRateBps) /
          10000n;
    assignedInterest += interest;
    rows.push(
      Object.freeze({
        period: String(period),
        due: loanDueDate(start, period, terms.dates),
        principal: money(part, principal.currency),
        interest: money(interest, principal.currency),
      }),
    );
  }
  return Object.freeze(rows);
}
export function allocateLoanPayment(
  schedule: readonly Instalment[],
  paid: readonly LoanAllocation[],
  amount: Money,
  order: LoanTerms['allocation'],
): readonly LoanAllocation[] {
  if (
    amount.minor <= 0n ||
    !['interest_first', 'principal_first'].includes(order)
  )
    throw new Error('Invalid loan payment');
  money(amount.minor, amount.currency);
  const totals = new Map<string, { principal: bigint; interest: bigint }>();
  for (const row of paid) {
    if (
      row.principal.currency !== amount.currency ||
      row.interest.currency !== amount.currency
    )
      throw new Error('Mixed loan currencies');
    const t = totals.get(row.period) ?? { principal: 0n, interest: 0n };
    t.principal += row.principal.minor;
    t.interest += row.interest.minor;
    totals.set(row.period, t);
  }
  let remaining: bigint = amount.minor;
  const seen = new Set<string>(),
    result: LoanAllocation[] = [];
  for (const row of schedule) {
    if (
      seen.has(row.period) ||
      row.principal.currency !== amount.currency ||
      row.interest.currency !== amount.currency ||
      row.principal.minor < 0n ||
      row.interest.minor < 0n
    )
      throw new Error('Invalid loan schedule');
    seen.add(row.period);
    const t = totals.get(row.period) ?? { principal: 0n, interest: 0n };
    if (
      t.principal < 0n ||
      t.interest < 0n ||
      t.principal > row.principal.minor ||
      t.interest > row.interest.minor
    )
      throw new Error('Invalid paid allocation');
    const dueP = row.principal.minor - t.principal,
      dueI = row.interest.minor - t.interest;
    let p: bigint;
    let i: bigint;
    if (order === 'interest_first') {
      i = remaining < dueI ? remaining : dueI;
      remaining -= i;
      p = remaining < dueP ? remaining : dueP;
      remaining -= p;
    } else {
      p = remaining < dueP ? remaining : dueP;
      remaining -= p;
      i = remaining < dueI ? remaining : dueI;
      remaining -= i;
    }
    if (p + i > 0n)
      result.push(
        Object.freeze({
          period: row.period,
          principal: money(p, amount.currency),
          interest: money(i, amount.currency),
        }),
      );
  }
  if (remaining !== 0n || [...totals.keys()].some((k) => !seen.has(k)))
    throw new Error('Payment exceeds loan balance');
  return Object.freeze(result);
}
export function loanJournal(
  id: string,
  principal: Money,
  interest: Money,
): Journal {
  if (
    principal.currency !== interest.currency ||
    (principal.minor < 0n && interest.minor > 0n) ||
    (principal.minor > 0n && interest.minor < 0n)
  )
    throw new Error('Invalid loan movement');
  const cash = money(principal.minor + interest.minor, principal.currency);
  if (cash.minor === 0n) throw new Error('Empty loan movement');
  const lines: JournalLine[] = [
    Object.freeze({
      account: 'cash',
      side: cash.minor > 0n ? 'debit' : 'credit',
      amount: money(cash.minor < 0n ? -cash.minor : cash.minor, cash.currency),
    }),
  ];
  for (const [account, value] of [
    ['loans_receivable', principal.minor],
    ['interest_income', interest.minor],
  ] as const)
    if (value !== 0n)
      lines.push(
        Object.freeze({
          account,
          side: value > 0n ? 'credit' : 'debit',
          amount: money(value < 0n ? -value : value, cash.currency),
        }),
      );
  return Object.freeze({
    id,
    calcVersion: loanCalcVersion,
    lines: Object.freeze(lines),
  });
}
