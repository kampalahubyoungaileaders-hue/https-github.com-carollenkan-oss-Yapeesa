import {
  accountBalance,
  money,
  reverseJournal,
  shareJournal,
  type Journal,
} from '@yapesa/domain';
export interface Group {
  id: string;
  name: string;
  initials: string;
  country: string;
  currency: string;
  minorDigits: number;
  timeZone: string;
  sharePrice: string;
  maxShares: string;
  cycleStart: string;
  cycleEnd: string;
  color: string;
}
export interface Member {
  id: string;
  name: string;
  joined: string;
}
export interface Entry {
  id: string;
  groupId: string;
  memberId: string;
  meetingDate: string;
  recordedAt: string;
  shares: string;
  kind: 'share_purchase' | 'reversal';
  reverses: string | null;
  note: string;
}
export interface Workspace {
  version: 1;
  entries: Entry[];
}
export const groups: readonly Group[] = [
  {
    id: 'umoja',
    name: 'Umoja Savings Group',
    initials: 'US',
    country: 'UG',
    currency: 'UGX',
    minorDigits: 0,
    timeZone: 'Africa/Kampala',
    sharePrice: '5000',
    maxShares: '5',
    cycleStart: '2026-01-10',
    cycleEnd: '2026-12-19',
    color: 'teal',
  },
  {
    id: 'nakawa',
    name: 'Nakawa Community Savers',
    initials: 'NC',
    country: 'UG',
    currency: 'UGX',
    minorDigits: 0,
    timeZone: 'Africa/Kampala',
    sharePrice: '2000',
    maxShares: '5',
    cycleStart: '2026-02-14',
    cycleEnd: '2026-12-12',
    color: 'blue',
  },
  {
    id: 'kasubi',
    name: 'Kasubi Traders Circle',
    initials: 'KT',
    country: 'UG',
    currency: 'UGX',
    minorDigits: 0,
    timeZone: 'Africa/Kampala',
    sharePrice: '10000',
    maxShares: '5',
    cycleStart: '2026-03-07',
    cycleEnd: '2027-02-06',
    color: 'orange',
  },
];
export const members: readonly Member[] = [
  { id: 'amina', name: 'Amina N.', joined: '2026-01-10' },
  { id: 'joseph', name: 'Joseph K.', joined: '2026-01-10' },
  { id: 'grace', name: 'Grace N.', joined: '2026-01-10' },
  { id: 'peter', name: 'Peter O.', joined: '2026-01-10' },
  { id: 'sarah', name: 'Sarah A.', joined: '2026-01-10' },
  { id: 'david', name: 'David M.', joined: '2026-01-10' },
  { id: 'esther', name: 'Esther W.', joined: '2026-01-10' },
  { id: 'brian', name: 'Brian S.', joined: '2026-01-10' },
];
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.valueOf()) && date.toISOString().startsWith(value)
  );
}
export function initialWorkspace(): Workspace {
  const dates = [
    '2026-09-26',
    '2026-10-03',
    '2026-10-10',
    '2026-10-17',
    '2026-10-24',
    '2026-10-31',
  ];
  return {
    version: 1,
    entries: groups.flatMap((group, gi) =>
      dates.flatMap((date, di) =>
        members.map((member, mi) => ({
          id: `sample-${group.id}-${di}-${member.id}`,
          groupId: group.id,
          memberId: member.id,
          meetingDate: date,
          recordedAt: `${date}T11:${String(mi).padStart(2, '0')}:00Z`,
          shares: String(1 + ((di + mi + gi) % 5)),
          kind: 'share_purchase' as const,
          reverses: null,
          note: '',
        })),
      ),
    ),
  };
}
export function groupById(id: string): Group {
  const group = groups.find((item) => item.id === id);
  if (!group) throw new Error('Unknown group');
  return group;
}
export function entriesFor(state: Workspace, groupId: string): Entry[] {
  return state.entries.filter((entry) => entry.groupId === groupId);
}
export function entryJournal(entry: Entry, state: Workspace): Journal {
  const group = groupById(entry.groupId);
  if (entry.kind === 'reversal') {
    const original = state.entries.find(
      (item) => item.id === entry.reverses && item.kind === 'share_purchase',
    );
    if (
      !original ||
      original.groupId !== entry.groupId ||
      original.memberId !== entry.memberId ||
      original.shares !== entry.shares
    )
      throw new Error('Invalid reversal');
    return reverseJournal(
      entry.id,
      shareJournal(
        original.id,
        money(BigInt(group.sharePrice), group.currency),
        BigInt(original.shares),
      ),
    );
  }
  return shareJournal(
    entry.id,
    money(BigInt(group.sharePrice), group.currency),
    BigInt(entry.shares),
  );
}
export function cashBalance(state: Workspace, groupId: string): bigint {
  const group = groupById(groupId);
  return accountBalance(
    entriesFor(state, groupId).map((entry) => entryJournal(entry, state)),
    'cash',
    group.currency,
  );
}
export function totalShares(entries: readonly Entry[]): bigint {
  return entries.reduce(
    (total, entry) =>
      total +
      (entry.kind === 'reversal'
        ? -BigInt(entry.shares)
        : BigInt(entry.shares)),
    0n,
  );
}
export function appendPurchase(
  state: Workspace,
  input: {
    id: string;
    groupId: string;
    memberId: string;
    meetingDate: string;
    shares: string;
    note: string;
    recordedAt: string;
  },
): Workspace {
  const group = groupById(input.groupId);
  if (
    !members.some((member) => member.id === input.memberId) ||
    !validDate(input.meetingDate)
  )
    throw new Error('Invalid member or date');
  if (
    input.meetingDate < group.cycleStart ||
    input.meetingDate > group.cycleEnd
  )
    throw new Error('Date is outside this cycle');
  if (!/^[1-9]\d*$/.test(input.shares) || input.shares.length > 3)
    throw new Error('Invalid share count');
  if (state.entries.some((entry) => entry.id === input.id))
    throw new Error('Duplicate reference');
  const existing = totalShares(
    entriesFor(state, input.groupId).filter(
      (entry) =>
        entry.memberId === input.memberId &&
        entry.meetingDate === input.meetingDate,
    ),
  );
  if (BigInt(input.shares) + existing > BigInt(group.maxShares))
    throw new Error('Meeting share limit exceeded');
  if (input.note.length > 240 || !Number.isFinite(Date.parse(input.recordedAt)))
    throw new Error('Invalid note or timestamp');
  const entry: Entry = { ...input, kind: 'share_purchase', reverses: null };
  entryJournal(entry, state);
  const next: Workspace = { ...state, entries: [...state.entries, entry] };
  cashBalance(next, group.id);
  return next;
}
export function appendReversal(
  state: Workspace,
  originalId: string,
  id: string,
  note: string,
  recordedAt: string,
): Workspace {
  const original = state.entries.find((entry) => entry.id === originalId);
  if (
    !original ||
    original.kind !== 'share_purchase' ||
    state.entries.some(
      (entry) => entry.reverses === originalId || entry.id === id,
    )
  )
    throw new Error('Transaction cannot be reversed');
  if (
    !note.trim() ||
    note.length > 240 ||
    !Number.isFinite(Date.parse(recordedAt))
  )
    throw new Error('A reversal reason is required');
  const entry: Entry = {
    ...original,
    id,
    kind: 'reversal',
    reverses: originalId,
    note: note.trim(),
    recordedAt,
  };
  const next: Workspace = { ...state, entries: [...state.entries, entry] };
  cashBalance(next, original.groupId);
  return next;
}
export function parseWorkspace(raw: string): Workspace {
  const data: unknown = JSON.parse(raw);
  if (
    !data ||
    typeof data !== 'object' ||
    !('version' in data) ||
    data.version !== 1 ||
    !('entries' in data) ||
    !Array.isArray(data.entries) ||
    data.entries.length > 10000
  )
    throw new Error('Invalid demo data');
  let state: Workspace = { version: 1, entries: [] };
  for (const item of data.entries as unknown[]) {
    if (!item || typeof item !== 'object') throw new Error('Invalid record');
    const e = item as Record<string, unknown>;
    for (const key of [
      'id',
      'groupId',
      'memberId',
      'meetingDate',
      'recordedAt',
      'shares',
      'kind',
      'note',
    ])
      if (typeof e[key] !== 'string') throw new Error('Invalid record');
    const input = {
      id: e['id'] as string,
      groupId: e['groupId'] as string,
      memberId: e['memberId'] as string,
      meetingDate: e['meetingDate'] as string,
      recordedAt: e['recordedAt'] as string,
      shares: e['shares'] as string,
      note: e['note'] as string,
    };
    if (e['kind'] === 'share_purchase' && e['reverses'] === null)
      state = appendPurchase(state, input);
    else if (e['kind'] === 'reversal' && typeof e['reverses'] === 'string') {
      const original = state.entries.find(
        (entry) => entry.id === e['reverses'],
      );
      if (
        !original ||
        original.groupId !== input.groupId ||
        original.memberId !== input.memberId ||
        original.shares !== input.shares ||
        original.meetingDate !== input.meetingDate
      )
        throw new Error('Invalid reversal record');
      state = appendReversal(
        state,
        e['reverses'],
        input.id,
        input.note,
        input.recordedAt,
      );
    } else throw new Error('Unknown record type');
  }
  return state;
}
export function formatAmount(minor: bigint, group: Group): string {
  const scale = 10n ** BigInt(group.minorDigits);
  const absolute = minor < 0n ? -minor : minor;
  const whole = new Intl.NumberFormat('en-UG', {
    maximumFractionDigits: 0,
  }).format(absolute / scale);
  const fraction = group.minorDigits
    ? `.${String(absolute % scale).padStart(group.minorDigits, '0')}`
    : '';
  return `${minor < 0n ? '−' : ''}${group.currency} ${whole}${fraction}`;
}
export function csvCell(value: string): string {
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function exportRows(rows: readonly (readonly string[])[]): string {
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
