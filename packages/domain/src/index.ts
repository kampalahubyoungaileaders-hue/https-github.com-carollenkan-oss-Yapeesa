// Pure calculations for the explicitly labelled web demo. Database posting,
// authorisation and authoritative server recalculation remain Phase 1 work.
export const calcVersion = 'groups-shares-v1';
declare const minorUnitBrand: unique symbol;
export type MinorUnits = bigint & { readonly [minorUnitBrand]: true };
export type Money = Readonly<{ minor: MinorUnits; currency: string }>;
export type Account = 'cash' | 'share_capital';
export type JournalLine = Readonly<{
  account: Account;
  side: 'debit' | 'credit';
  amount: Money;
}>;
export type Journal = Readonly<{
  id: string;
  calcVersion: string;
  lines: readonly JournalLine[];
}>;
const MAX_MINOR = 9223372036854775807n;
export function money(minor: bigint, currency: string): Money {
  if (typeof minor !== 'bigint' || minor > MAX_MINOR || minor < -MAX_MINOR)
    throw new Error('Invalid integer amount');
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency code');
  return Object.freeze({ minor: minor as MinorUnits, currency });
}
export function shareJournal(
  id: string,
  price: Money,
  shares: bigint,
): Journal {
  if (price.minor <= 0n || shares <= 0n)
    throw new Error('Price and shares must be positive');
  const amount = money(price.minor * shares, price.currency);
  return Object.freeze({
    id,
    calcVersion,
    lines: Object.freeze([
      Object.freeze({ account: 'cash', side: 'debit', amount } as const),
      Object.freeze({
        account: 'share_capital',
        side: 'credit',
        amount,
      } as const),
    ]),
  });
}
export function reverseJournal(id: string, original: Journal): Journal {
  journalBalance(original);
  return Object.freeze({
    id,
    calcVersion,
    lines: Object.freeze(
      original.lines.map((line) =>
        Object.freeze({
          ...line,
          side:
            line.side === 'debit' ? ('credit' as const) : ('debit' as const),
        }),
      ),
    ),
  });
}
export function journalBalance(journal: Journal): bigint {
  let currency: string | undefined;
  let balance = 0n;
  for (const line of journal.lines) {
    if (
      line.amount.minor <= 0n ||
      (currency !== undefined && currency !== line.amount.currency)
    )
      throw new Error('Invalid journal');
    currency = line.amount.currency;
    balance += line.side === 'debit' ? line.amount.minor : -line.amount.minor;
  }
  if (!currency || balance !== 0n) throw new Error('Unbalanced journal');
  return balance;
}
export function accountBalance(
  journals: readonly Journal[],
  account: Account,
  currency: string,
): bigint {
  let balance = 0n;
  for (const journal of journals) {
    journalBalance(journal);
    for (const line of journal.lines) {
      if (line.amount.currency !== currency)
        throw new Error('Currencies cannot be combined');
      if (line.account === account)
        balance +=
          line.side === 'debit' ? line.amount.minor : -line.amount.minor;
    }
  }
  return money(balance, currency).minor;
}
