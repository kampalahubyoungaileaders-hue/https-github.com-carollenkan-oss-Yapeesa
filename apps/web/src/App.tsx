import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '@yapesa/i18n';
import { calcVersion } from '@yapesa/domain';
import { Icon, type IconName } from './icons';
import {
  groups,
  members,
  membersForGroup,
  initialWorkspace,
  parseWorkspace,
  entriesFor,
  cashBalance,
  totalShares,
  appendPurchase,
  appendReversal,
  entryJournal,
  formatAmount,
  exportRows,
  type Entry,
  type Group,
  type Workspace,
} from './workspace';

type Page = 'overview' | 'meetings' | 'members' | 'ledger';
type Modal =
  | { type: 'purchase' }
  | { type: 'journal'; entry: Entry }
  | { type: 'reverse'; entry: Entry }
  | { type: 'reset' }
  | null;
const STORAGE_KEY = 'yapesa-web-demo-v2';
const navigation: { page: Page; icon: IconName }[] = [
  { page: 'overview', icon: 'grid' },
  { page: 'meetings', icon: 'calendar' },
  { page: 'members', icon: 'people' },
  { page: 'ledger', icon: 'ledger' },
];
function loadDemo(): { state: Workspace; writable: boolean } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return {
      state: saved ? parseWorkspace(saved) : initialWorkspace(),
      writable: true,
    };
  } catch {
    return { state: initialWorkspace(), writable: false };
  }
}
function readPage(): Page {
  const page = location.hash.slice(1);
  return navigation.some((item) => item.page === page)
    ? (page as Page)
    : 'overview';
}
function dateLabel(date: string, group: Group, long = false): string {
  return new Intl.DateTimeFormat('en-UG', {
    day: 'numeric',
    month: long ? 'long' : 'short',
    year: 'numeric',
    timeZone: group.timeZone,
  }).format(new Date(date.length === 10 ? `${date}T12:00:00Z` : date));
}
function memberName(id: string): string {
  return members.find((member) => member.id === id)?.name ?? id;
}
function initials(name: string): string {
  return name
    .split(' ')
    .map((word) => word.charAt(0))
    .join('')
    .slice(0, 2);
}
function Button({
  children,
  onClick,
  primary = false,
  icon,
  type = 'button',
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  icon?: IconName;
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      className={`button ${primary ? 'primary' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <Icon name={icon} size={17} />}
      {children}
    </button>
  );
}
function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={t('close')}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function App() {
  const [session, setSession] = useState(loadDemo);
  const [page, setPage] = useState<Page>(readPage);
  const [groupId, setGroupId] = useState('umoja');
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState('');
  const [meeting, setMeeting] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const [memberId, setMemberId] = useState('');
  const [shares, setShares] = useState('1');
  const [meetingDate, setMeetingDate] = useState('2026-11-03');
  const [note, setNote] = useState('');
  const group = groups.find((item) => item.id === groupId) ?? groups[0]!;
  const groupMembers = membersForGroup(group.id);
  const state = session.state;
  const entries = useMemo(() => entriesFor(state, group.id), [state, group]);
  const sorted = useMemo(
    () =>
      [...entries].sort(
        (a, b) =>
          b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id),
      ),
    [entries],
  );
  const meetingDates = [...new Set(entries.map((entry) => entry.meetingDate))]
    .sort()
    .reverse();
  const balance = cashBalance(state, group.id);
  const reversedIds = new Set(
    entries.filter((entry) => entry.reverses).map((entry) => entry.reverses),
  );
  useEffect(() => {
    const update = () => {
      setPage(readPage());
      setSearch('');
      setMeeting(null);
      setPerson(null);
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  function navigate(next: Page) {
    location.hash = next;
    setPage(next);
    setSearch('');
    setMeeting(null);
    setPerson(null);
    setMenu(false);
  }
  function selectGroup(id: string) {
    setGroupId(id);
    setMeeting(null);
    setPerson(null);
    setSearch('');
  }
  function commit(next: Workspace, reset = false) {
    let writable = session.writable || reset;
    if (writable) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        writable = false;
      }
    }
    setSession({ state: next, writable });
  }
  function openPurchase() {
    setMemberId('');
    setShares('1');
    setMeetingDate(meeting ?? '2026-11-03');
    setNote('');
    setFormError('');
    setModal({ type: 'purchase' });
  }
  function submitPurchase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const next = appendPurchase(state, {
        id: `demo-${Date.now()}-${state.entries.length}`,
        groupId: group.id,
        memberId,
        meetingDate,
        shares,
        note: note.trim(),
        recordedAt: new Date().toISOString(),
      });
      commit(next);
      setModal(null);
      setNotice(t('recordSuccess'));
    } catch {
      setFormError(t('formError'));
    }
  }
  function submitReversal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (modal?.type !== 'reverse') return;
    try {
      commit(
        appendReversal(
          state,
          modal.entry.id,
          `demo-reversal-${Date.now()}-${state.entries.length}`,
          note,
          new Date().toISOString(),
        ),
      );
      setModal(null);
      setNotice(t('reversalSuccess'));
    } catch {
      setFormError(t('reversalError'));
    }
  }
  function download(entriesToExport: readonly Entry[]) {
    const rows = [
      [
        t('journalRef'),
        t('groupName'),
        t('member'),
        t('dateLabel'),
        t('recordedAt'),
        t('typeLabel'),
        t('sharesLabel'),
        t('signedAmount'),
        t('currencyLabel'),
        t('notesColumn'),
      ],
      ...entriesToExport.map((entry) => [
        entry.id,
        group.name,
        memberName(entry.memberId),
        entry.meetingDate,
        entry.recordedAt,
        t(entry.kind === 'reversal' ? 'reversal' : 'purchase'),
        `${entry.kind === 'reversal' ? '-' : ''}${entry.shares}`,
        String(
          BigInt(group.sharePrice) *
            BigInt(entry.shares) *
            (entry.kind === 'reversal' ? -1n : 1n),
        ),
        group.currency,
        entry.note,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob([exportRows(rows)], { type: 'text/csv;charset=utf-8;' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `yapesa-demo-${group.id}-${page}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function entryAmount(entry: Entry) {
    return formatAmount(
      BigInt(group.sharePrice) *
        BigInt(entry.shares) *
        (entry.kind === 'reversal' ? -1n : 1n),
      group,
    );
  }
  const filtered = sorted.filter(
    (entry) =>
      `${memberName(entry.memberId)} ${entry.id} ${entry.note}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!meeting || entry.meetingDate === meeting) &&
      (!person || entry.memberId === person),
  );
  const recent = filtered.slice(0, page === 'overview' ? 5 : 10000);
  const subtitle =
    page === 'overview'
      ? 'workspaceSubtitle'
      : page === 'meetings'
        ? 'meetingSubtitle'
        : page === 'members'
          ? 'memberSubtitle'
          : 'ledgerSubtitle';
  const title = person
    ? memberName(person)
    : meeting
      ? dateLabel(meeting, group, true)
      : page === 'overview'
        ? t('workspace')
        : t(page);
  const recordList = (rows: readonly Entry[]) =>
    rows.length ? (
      <div className="record-list">
        {rows.map((entry) => (
          <button
            key={entry.id}
            className="record-row"
            onClick={() => {
              setFormError('');
              setModal({ type: 'journal', entry });
            }}
          >
            <span
              className={`activity-icon ${entry.kind === 'reversal' ? 'correction' : ''}`}
            >
              <Icon
                name={entry.kind === 'reversal' ? 'reset' : 'arrow'}
                size={17}
              />
            </span>
            <span className="record-person">
              <strong>{memberName(entry.memberId)}</strong>
              <small>
                {t(entry.kind === 'reversal' ? 'reversal' : 'purchase')} ·{' '}
                {dateLabel(entry.meetingDate, group)}
              </small>
            </span>
            <span className="record-value">
              <strong className={entry.kind === 'reversal' ? 'negative' : ''}>
                {entryAmount(entry)}
              </strong>
              <small>
                {reversedIds.has(entry.id) ? t('reversed') : t('recorded')}
              </small>
            </span>
            <Icon name="chevron" size={15} />
          </button>
        ))}
      </div>
    ) : (
      <div className="empty-state">
        <Icon name="ledger" size={30} />
        <h3>{t('noRecords')}</h3>
        <p>{t('noRecordsHelp')}</p>
      </div>
    );
  return (
    <div className="app-shell">
      {menu && (
        <button
          className="nav-overlay"
          aria-label={t('closeNavigation')}
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? 'is-open' : ''}`}>
        <a
          href="#overview"
          className="brand"
          onClick={() => navigate('overview')}
        >
          <span className="brand-mark">
            <Icon name="leaf" size={25} />
          </span>
          <span>
            Yapesa<small>{t('brandDescriptor')}</small>
          </span>
        </a>
        <div className="sidebar-workspace">
          <span className="workspace-avatar">F</span>
          <span>
            <strong>{t('demoBadge')}</strong>
            <small>{t('groupsLabel')}</small>
          </span>
          <span className="workspace-dot" />
        </div>
        <p className="nav-label">{t('workspace')}</p>
        <nav aria-label={t('workspace')}>
          {navigation.map((item) => (
            <a
              key={item.page}
              href={`#${item.page}`}
              onClick={() => navigate(item.page)}
              className={page === item.page ? 'active' : ''}
            >
              <Icon name={item.icon} />
              <span>{t(item.page)}</span>
              {page === item.page && <span className="nav-active-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="quiet-info">
            <Icon name="shield" size={22} />
            <strong>{t('previewOnly')}</strong>
            <p>{t('demoNotice')}</p>
          </div>
          <button
            className="reset-link"
            onClick={() => setModal({ type: 'reset' })}
          >
            <Icon name="reset" size={16} />
            {t('resetDemo')}
          </button>
          <a className="button open-saved" href="#live">
            {t('openSaved')}
          </a>
          <p className="powered">{t('poweredBy')}</p>
        </div>
      </aside>
      <div className="workspace-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMenu(!menu)}
            aria-label={t('openNavigation')}
          >
            <Icon name="menu" />
          </button>
          <span className="breadcrumb">
            {t('groupsLabel')}
            <span>/</span>
            <strong>{t(page)}</strong>
          </span>
          <div className="topbar-right">
            <span className="demo-pill">
              <span />
              {t('demoBadge')}
            </span>
            <span className="avatar small">F</span>
          </div>
        </header>
        <main id="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {t('groupsLabel')} <span> / </span> {group.name}
              </p>
              <h1>{title}</h1>
              <p className="page-subtitle">
                {person
                  ? t('passbookHelp')
                  : meeting
                    ? t('meetingDetail')
                    : t(subtitle)}
              </p>
            </div>
            <div className="heading-actions">
              <Button icon="download" onClick={() => download(filtered)}>
                {t('exportCsv')}
              </Button>
              <Button primary icon="plus" onClick={openPurchase}>
                {t('recordShares')}
              </Button>
            </div>
          </div>
          <div className="workspace-controls">
            <label className="group-select">
              <span className={`group-tiny ${group.color}`}>
                {group.initials}
              </span>
              <select
                value={group.id}
                onChange={(event) => selectGroup(event.target.value)}
                aria-label={t('groupSelector')}
              >
                {groups.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <span
              className={`persistence ${session.writable ? '' : 'warning'}`}
            >
              <span />
              {t(session.writable ? 'savedLocally' : 'temporary')}
            </span>
          </div>
          <div className="demo-banner">
            <Icon name="shield" size={17} />
            <span>{t('demoNotice')}</span>
          </div>
          <p className="demo-dataset-note">{t('demoSnapshot')}</p>
          {!session.writable && (
            <p className="inline-warning" role="alert">
              {t('storageWarning')}
            </p>
          )}
          {(person || meeting) && (
            <button
              className="back-link"
              onClick={() => {
                setPerson(null);
                setMeeting(null);
                setSearch('');
              }}
            >
              <Icon name="back" size={16} />
              {t(person ? 'backMembers' : 'backMeetings')}
            </button>
          )}
          {page === 'overview' && (
            <>
              <div className="stats-grid">
                <Stat
                  label={t('cashRecorded')}
                  value={formatAmount(balance, group)}
                  detail={t('shareCapital')}
                  icon="wallet"
                  accent
                />
                <Stat
                  label={t('sharesPurchased')}
                  value={String(totalShares(entries))}
                  detail={t('activeCycle')}
                  icon="leaf"
                />
                <Stat
                  label={t('participatingMembers')}
                  value={String(
                    new Set(entries.map((entry) => entry.memberId)).size,
                  )}
                  detail={t('acrossMembers').replace(
                    '{count}',
                    String(groupMembers.length),
                  )}
                  icon="people"
                />
                <Stat
                  label={t('meetingsRecorded')}
                  value={String(meetingDates.length)}
                  detail={t('activeCycle')}
                  icon="calendar"
                />
              </div>
              <div className="overview-middle">
                <section className="panel chart-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>{t('contributionActivity')}</h2>
                      <p>{t('activityHelp')}</p>
                    </div>
                    <span className="subtle-tag">{group.currency}</span>
                  </div>
                  <div
                    className="chart"
                    role="img"
                    aria-label={t('contributionActivity')}
                  >
                    {meetingDates
                      .slice(0, 6)
                      .reverse()
                      .map((date) => {
                        const count = totalShares(
                          entries.filter((entry) => entry.meetingDate === date),
                        );
                        const percent = Number(
                          (count * 100n) /
                            (BigInt(groupMembers.length) *
                              BigInt(group.maxShares)),
                        );
                        return (
                          <div className="chart-column" key={date}>
                            <span className="chart-value">
                              {formatAmount(
                                count * BigInt(group.sharePrice),
                                group,
                              )}
                            </span>
                            <div className="bar-track">
                              <div
                                className="bar"
                                style={{ height: `${Math.max(percent, 2)}%` }}
                              />
                            </div>
                            <span className="chart-date">
                              {new Intl.DateTimeFormat('en-UG', {
                                day: 'numeric',
                                month: 'short',
                                timeZone: group.timeZone,
                              }).format(new Date(`${date}T12:00:00Z`))}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </section>
                <section className="cycle-panel">
                  <div className="cycle-art">
                    <Icon name="leaf" size={36} />
                  </div>
                  <span className="cycle-status">
                    <span />
                    {t('activeCycle')}
                  </span>
                  <h2>{group.name}</h2>
                  <p>
                    {dateLabel(group.cycleStart, group)} –{' '}
                    {dateLabel(group.cycleEnd, group)}
                  </p>
                  <div className="cycle-price">
                    <span>{t('sharePrice')}</span>
                    <strong>
                      {formatAmount(BigInt(group.sharePrice), group)}
                    </strong>
                  </div>
                  <div className="cycle-limit">
                    <span>{t('shareLimit')}</span>
                    <strong>{group.maxShares}</strong>
                  </div>
                </section>
              </div>
              <section className="groups-section">
                <div className="section-heading">
                  <div>
                    <h2>{t('yourGroups')}</h2>
                    <p>{t('groupsHelp')}</p>
                  </div>
                  <span className="count-badge">{groups.length}</span>
                </div>
                <div className="group-cards">
                  {groups.map((item) => (
                    <button
                      key={item.id}
                      className={`group-card ${group.id === item.id ? 'selected' : ''}`}
                      onClick={() => selectGroup(item.id)}
                      aria-pressed={group.id === item.id}
                    >
                      <span className="group-card-top">
                        <span className={`group-tiny ${item.color}`}>
                          {item.initials}
                        </span>
                        <span className="group-selected">
                          {group.id === item.id ? (
                            <Icon name="check" size={15} />
                          ) : (
                            <Icon name="arrow" size={16} />
                          )}
                        </span>
                      </span>
                      <strong>{item.name}</strong>
                      <span className="group-card-meta">
                        {membersForGroup(item.id).length}{' '}
                        {t('members').toLowerCase()} · {t('activeCycle')}
                      </span>
                      <span className="group-card-balance">
                        {formatAmount(cashBalance(state, item.id), item)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>{t('recentRecords')}</h2>
                    <p>{t('latestActivity')}</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate('ledger')}
                  >
                    {t('viewAll')}
                    <Icon name="arrow" size={16} />
                  </button>
                </div>
                {recordList(recent)}
              </section>
            </>
          )}
          {page === 'meetings' && !meeting && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>{t('meetingRecords')}</h2>
                  <p>{t('meetingHint')}</p>
                </div>
              </div>
              <div className="meeting-list">
                {meetingDates.length ? (
                  meetingDates.map((date) => {
                    const rows = entries.filter(
                      (entry) => entry.meetingDate === date,
                    );
                    return (
                      <button
                        className="meeting-row"
                        key={date}
                        onClick={() => {
                          setMeeting(date);
                          setSearch('');
                        }}
                      >
                        <span className="calendar-tile">
                          <small>
                            {new Intl.DateTimeFormat('en-UG', {
                              month: 'short',
                              timeZone: group.timeZone,
                            }).format(new Date(`${date}T12:00:00Z`))}
                          </small>
                          <strong>{date.slice(-2)}</strong>
                        </span>
                        <span className="meeting-title">
                          <strong>{dateLabel(date, group, true)}</strong>
                          <small>
                            {new Set(rows.map((entry) => entry.memberId)).size}{' '}
                            {t('members').toLowerCase()} · {rows.length}{' '}
                            {t('recordsLabel').toLowerCase()}
                          </small>
                        </span>
                        <span className="meeting-amount">
                          <strong>
                            {formatAmount(
                              totalShares(rows) * BigInt(group.sharePrice),
                              group,
                            )}
                          </strong>
                          <small>
                            {String(totalShares(rows))}{' '}
                            {t('sharesLabel').toLowerCase()}
                          </small>
                        </span>
                        <Icon name="chevron" size={17} />
                      </button>
                    );
                  })
                ) : (
                  <div className="empty-state">{t('noMeetings')}</div>
                )}
              </div>
            </section>
          )}
          {page === 'members' && !person && (
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  {t('members')}{' '}
                  <span className="count-badge">{groupMembers.length}</span>
                </h2>
                <Search
                  value={search}
                  onChange={setSearch}
                  label={t('searchMembers')}
                />
              </div>
              <div className="member-table">
                <div className="table-header">
                  <span>{t('member')}</span>
                  <span>{t('netShares')}</span>
                  <span>{t('contributions')}</span>
                  <span />
                </div>
                {groupMembers
                  .filter((member) =>
                    member.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((member) => {
                    const rows = entries.filter(
                      (entry) => entry.memberId === member.id,
                    );
                    return (
                      <button
                        key={member.id}
                        className="member-row"
                        onClick={() => {
                          setPerson(member.id);
                          setSearch('');
                        }}
                      >
                        <span className="member-name">
                          <span className="avatar">
                            {initials(member.name)}
                          </span>
                          <span>
                            <strong>{member.name}</strong>
                            <small>
                              {t('memberSince')}{' '}
                              {dateLabel(group.cycleStart, group)}
                            </small>
                          </span>
                        </span>
                        <span>{String(totalShares(rows))}</span>
                        <strong>
                          {formatAmount(
                            totalShares(rows) * BigInt(group.sharePrice),
                            group,
                          )}
                        </strong>
                        <Icon name="chevron" size={17} />
                      </button>
                    );
                  })}
                {!groupMembers.some((member) =>
                  member.name.toLowerCase().includes(search.toLowerCase()),
                ) && <div className="empty-state">{t('noMembers')}</div>}
              </div>
            </section>
          )}
          {(page === 'ledger' || person || meeting) && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    {t(
                      person
                        ? 'passbook'
                        : meeting
                          ? 'meetingDetail'
                          : 'ledger',
                    )}
                  </h2>
                  <p>
                    {t(
                      page === 'ledger'
                        ? 'ledgerHelp'
                        : person
                          ? 'passbookHelp'
                          : 'meetingHint',
                    )}
                  </p>
                </div>
                <Search
                  value={search}
                  onChange={setSearch}
                  label={t('searchRecords')}
                />
              </div>
              {(person || meeting) && (
                <div className="detail-summary">
                  <span>
                    {t('netShares')}
                    <strong>{String(totalShares(filtered))}</strong>
                  </span>
                  <span>
                    {t('contributions')}
                    <strong>
                      {formatAmount(
                        totalShares(filtered) * BigInt(group.sharePrice),
                        group,
                      )}
                    </strong>
                  </span>
                </div>
              )}
              {recordList(recent)}
            </section>
          )}
          <footer className="workspace-footer">
            <span>Yapesa · {t('poweredBy')}</span>
            <span>{t('previewOnly')}</span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          {notice}
        </div>
      )}
      {modal?.type === 'purchase' && (
        <Dialog title={t('newRecord')} onClose={() => setModal(null)}>
          <form onSubmit={submitPurchase}>
            <p className="dialog-description">{t('recordHelp')}</p>
            <div className="form-group">
              <label htmlFor="purchase-member">{t('member')}</label>
              <select
                id="purchase-member"
                required
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
              >
                <option value="">{t('chooseMember')}</option>
                {groupMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="purchase-date">{t('dateLabel')}</label>
                <input
                  id="purchase-date"
                  type="date"
                  required
                  min={group.cycleStart}
                  max={group.cycleEnd}
                  value={meetingDate}
                  onChange={(event) => setMeetingDate(event.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="purchase-shares">{t('shareCount')}</label>
                <input
                  id="purchase-shares"
                  inputMode="numeric"
                  type="number"
                  min="1"
                  max={group.maxShares}
                  step="1"
                  required
                  value={shares}
                  onChange={(event) => setShares(event.target.value)}
                />
              </div>
            </div>
            <div className="amount-preview">
              <span>{t('calculatedAmount')}</span>
              <strong>
                {formatAmount(
                  /^[1-9]\d{0,2}$/.test(shares)
                    ? BigInt(shares) * BigInt(group.sharePrice)
                    : 0n,
                  group,
                )}
              </strong>
              <small>
                {t('sharePrice')}:{' '}
                {formatAmount(BigInt(group.sharePrice), group)} · {t('maximum')}
                : {group.maxShares}
              </small>
            </div>
            <div className="form-group">
              <label htmlFor="purchase-note">{t('note')}</label>
              <textarea
                id="purchase-note"
                maxLength={240}
                placeholder={t('notePlaceholder')}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="dialog-actions">
              <Button onClick={() => setModal(null)}>{t('cancel')}</Button>
              <Button primary type="submit">
                {t('saveRecord')}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {modal?.type === 'journal' && (
        <Dialog title={t('journalDetail')} onClose={() => setModal(null)}>
          <div className="journal-person">
            <span className="avatar">
              {initials(memberName(modal.entry.memberId))}
            </span>
            <div>
              <strong>{memberName(modal.entry.memberId)}</strong>
              <p>
                {t(modal.entry.kind === 'reversal' ? 'reversal' : 'purchase')} ·{' '}
                {dateLabel(modal.entry.meetingDate, group)}
              </p>
            </div>
          </div>
          <dl className="journal-meta">
            <div>
              <dt>{t('journalRef')}</dt>
              <dd>{modal.entry.id}</dd>
            </div>
            <div>
              <dt>{t('recordedAt')}</dt>
              <dd>
                {new Intl.DateTimeFormat('en-UG', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: group.timeZone,
                }).format(new Date(modal.entry.recordedAt))}
              </dd>
            </div>
            <div>
              <dt>{t('calculationVersion')}</dt>
              <dd>{calcVersion}</dd>
            </div>
            {modal.entry.reverses && (
              <div>
                <dt>{t('originalReference')}</dt>
                <dd>{modal.entry.reverses}</dd>
              </div>
            )}
            {modal.entry.note && (
              <div>
                <dt>{t('notesColumn')}</dt>
                <dd>{modal.entry.note}</dd>
              </div>
            )}
          </dl>
          <table className="journal-lines">
            <thead>
              <tr>
                <th>{t('accountLabel')}</th>
                <th>{t('debit')}</th>
                <th>{t('credit')}</th>
              </tr>
            </thead>
            <tbody>
              {entryJournal(modal.entry, state).lines.map((line, index) => (
                <tr key={index}>
                  <td>
                    {t(
                      line.account === 'cash' ? 'cashAccount' : 'sharesAccount',
                    )}
                  </td>
                  <td>
                    {line.side === 'debit'
                      ? formatAmount(line.amount.minor, group)
                      : '—'}
                  </td>
                  <td>
                    {line.side === 'credit'
                      ? formatAmount(line.amount.minor, group)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="balanced">
            <Icon name="check" size={16} />
            {t('balanced')}
          </p>
          <div className="dialog-actions">
            {modal.entry.kind === 'share_purchase' &&
              !reversedIds.has(modal.entry.id) && (
                <Button
                  icon="reset"
                  onClick={() => {
                    setNote('');
                    setFormError('');
                    setModal({ type: 'reverse', entry: modal.entry });
                  }}
                >
                  {t('reverseEntry')}
                </Button>
              )}
            <Button primary onClick={() => setModal(null)}>
              {t('close')}
            </Button>
          </div>
        </Dialog>
      )}
      {modal?.type === 'reverse' && (
        <Dialog title={t('reverseEntry')} onClose={() => setModal(null)}>
          <form onSubmit={submitReversal}>
            <p className="dialog-description">{t('reversalHelp')}</p>
            <div className="amount-preview">
              <span>{memberName(modal.entry.memberId)}</span>
              <strong>{entryAmount(modal.entry)}</strong>
            </div>
            <div className="form-group">
              <label htmlFor="reversal-reason">{t('reason')}</label>
              <textarea
                id="reversal-reason"
                required
                maxLength={240}
                placeholder={t('reasonPlaceholder')}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="dialog-actions">
              <Button onClick={() => setModal(null)}>{t('cancel')}</Button>
              <Button primary type="submit">
                {t('confirmReversal')}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {modal?.type === 'reset' && (
        <Dialog title={t('resetTitle')} onClose={() => setModal(null)}>
          <p className="dialog-description">{t('resetHelp')}</p>
          <div className="dialog-actions">
            <Button onClick={() => setModal(null)}>{t('cancel')}</Button>
            <Button
              primary
              onClick={() => {
                commit(initialWorkspace(), true);
                setModal(null);
                setNotice(t('resetSuccess'));
              }}
            >
              {t('confirmReset')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  detail,
  icon,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: IconName;
  accent?: boolean;
}) {
  return (
    <section className={`stat-card ${accent ? 'accent' : ''}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">
          <Icon name={icon} size={19} />
        </span>
      </div>
      <strong className="stat-value">{value}</strong>
      <small>{detail}</small>
    </section>
  );
}
function Search({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <label className="search-field">
      <Icon name="search" size={17} />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
      />
    </label>
  );
}
