import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ClientError,
  newTransactionId,
  type Session,
  type GroupList,
  type SavedWorkspace,
  type Factor,
  type Receipt,
  type SharePurchase,
} from '@yapesa/api-client';
import { calcVersion } from '@yapesa/domain';
import { t } from '@yapesa/i18n';
import { Icon } from './icons';
import { exportRows } from './workspace';
import InvitationForm from './InvitationForm';
import Administration from './Administration';
import RecoveryForm from './RecoveryForm';
import ShareCorrection from './ShareCorrection';
import ShareOutPreview from './ShareOutPreview';
import Meetings from './Meetings';
function errorMessage(error: unknown): string {
  const code = error instanceof ClientError ? error.code : '';
  const messages: Record<string, Parameters<typeof t>[0]> = {
    INVALID_CREDENTIALS: 'loginError',
    PIN_LOCKED: 'lockedPin',
    PERMISSION_DENIED: 'permissionError',
    MFA_REQUIRED: 'mfaError',
    INVALID_SHARE_PURCHASE: 'invalidShares',
    DUPLICATE_REFERENCE: 'duplicateRequest',
    TOO_MANY_ATTEMPTS: 'rateLimited',
    AUTH_REQUIRED: 'sessionExpired',
    AUTH_NOT_CONFIGURED: 'authPreparing',
    NETWORK_ERROR: 'connectionError',
    STATEMENT_TOO_LARGE: 'pdfTooLarge',
    BACKEND_UNAVAILABLE: 'connectionError',
  };
  return t(messages[code] ?? 'requestError');
}
const titleKeys = {
  overview: 'overview',
  meetings: 'meetings',
  members: 'members',
  ledger: 'ledger',
} as const;
type Tab = keyof typeof titleKeys;
function amount(value: string | bigint, workspace: SavedWorkspace): string {
  const minor = BigInt(value);
  const scale = 10n ** BigInt(workspace.group.minor_digits);
  const absolute = minor < 0n ? -minor : minor;
  return `${minor < 0n ? '−' : ''}${workspace.group.currency} ${new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(absolute / scale)}${scale > 1n ? '.' + String(absolute % scale).padStart(workspace.group.minor_digits, '0') : ''}`;
}
function day(value: string, zone: string) {
  return new Intl.DateTimeFormat('en-UG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: zone,
  }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
}
export default function SecureApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [invitation, setInvitation] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [factor, setFactor] = useState<Factor | null>(null);
  const [factorId, setFactorId] = useState('');
  const [groups, setGroups] = useState<GroupList>([]);
  const [workspace, setWorkspace] = useState<SavedWorkspace | null>(null);
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [menu, setMenu] = useState(false);
  const [member, setMember] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [shares, setShares] = useState('1');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [memberFilter, setMemberFilter] = useState('');
  const [search, setSearch] = useState('');
  const [journal, setJournal] = useState<string | null>(null);
  const pending = useRef<{ hash: string; id: string } | null>(null);
  const device = useRef<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    api
      .session()
      .then((value) => {
        if (!cancelled) setSession(value);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (
      !session?.user ||
      (session.user.requires_mfa && !session.user.mfa_verified)
    )
      return;
    let cancelled = false;
    setLoading(true);
    api
      .groups()
      .then(async (values) => {
        if (cancelled) return;
        setGroups(values);
        const first = values[0];
        if (first) {
          const data = await api.workspace(first.id);
          if (cancelled) return;
          setSelected(first.id);
          setWorkspace(data);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);
  async function handle(action: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ClientError && err.status === 401) {
        setWorkspace(null);
        setGroups([]);
        setSession(await api.session());
      }
    } finally {
      setBusy(false);
    }
  }
  async function signIn(event: FormEvent) {
    event.preventDefault();
    await handle(async () => {
      const value = await api.login(phone, pin);
      setSession(value);
      setPin('');
    });
    setPin('');
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    await handle(async () => {
      const id = factor?.id || factorId || session?.user?.factors[0]?.id;
      if (!id) throw new Error('No factor');
      setSession(await api.verify(id, code));
      setCode('');
      setFactor(null);
    });
  }
  async function refresh(id = selected) {
    if (!id) return;
    const data = await api.workspace(id);
    setWorkspace(data);
    setSelected(id);
    setJournal(null);
  }
  async function chooseGroup(id: string) {
    await handle(async () => {
      await refresh(id);
      setMember('');
      setMemberFilter('');
      setReceipt(null);
      setSearch('');
    });
  }
  function deviceId(id: string) {
    if (device.current[id]) return device.current[id]!;
    const key = `yapesa-device-${id}`;
    let value: string | null = null;
    try {
      value = localStorage.getItem(key);
    } catch {
      /* use an in-memory device if storage is unavailable */
    }
    if (!value) {
      value = newTransactionId();
      try {
        localStorage.setItem(key, value);
      } catch {
        /* server still enforces the designated device */
      }
    }
    device.current[id] = value;
    return value;
  }
  async function reference(input: Omit<SharePurchase, 'client_id'>) {
    const bytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(input)),
    );
    const hash = Array.from(new Uint8Array(bytes))
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
    const key = `yapesa-pending-${selected}`;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const value: unknown = JSON.parse(raw);
        if (
          value &&
          typeof value === 'object' &&
          'hash' in value &&
          value.hash === hash &&
          'id' in value &&
          typeof value.id === 'string'
        )
          pending.current = { hash, id: value.id };
      }
    } catch {
      /* the in-memory reference remains available for a retry */
    }
    if (pending.current?.hash !== hash)
      pending.current = { hash, id: newTransactionId() };
    try {
      sessionStorage.setItem(key, JSON.stringify(pending.current));
    } catch {
      /* no financial data or token is stored here */
    }
    return pending.current.id;
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!workspace?.cycle) return;
    await handle(async () => {
      if (!/^[1-9][0-9]{0,18}$/.test(shares))
        throw new ClientError(422, 'INVALID_SHARE_PURCHASE');
      const input: Omit<SharePurchase, 'client_id'> = {
        member_id: member,
        meeting_date: date,
        shares,
        device_id: deviceId(selected),
        client_amount: String(
          BigInt(shares) * BigInt(workspace.cycle!.share_price),
        ),
        client_calc_version: calcVersion,
        note: note.trim(),
      };
      const client_id = await reference(input);
      let saved: Receipt;
      try {
        saved = await api.recordShares(selected, { ...input, client_id });
      } catch (error) {
        // A confirmed client rejection did not post; an interrupted response may
        // have posted, so preserve its reference and freeze the form for retry.
        if (
          error instanceof ClientError &&
          error.status >= 400 &&
          error.status < 500
        ) {
          pending.current = null;
          try {
            sessionStorage.removeItem(`yapesa-pending-${selected}`);
          } catch {
            /* in-memory state is clear */
          }
        }
        throw error;
      }
      setReceipt(saved);
      pending.current = null;
      try {
        sessionStorage.removeItem(`yapesa-pending-${selected}`);
      } catch {
        /* receipt is already confirmed by the server */
      }
      setMember('');
      setNote('');
      await refresh();
    });
  }
  async function signOut() {
    await handle(async () => {
      await api.logout();
      setSession({ configured: true, user: null });
      setWorkspace(null);
      setGroups([]);
      setFactor(null);
      setReceipt(null);
    });
  }
  async function exportPdf() {
    await handle(async () => {
      const blob = await api.statement(selected, memberFilter || undefined);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `yapesa-${selected}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function exportCsv() {
    if (!workspace) return;
    const data = [
      [
        t('journalRef'),
        t('member'),
        t('dateLabel'),
        t('sharesLabel'),
        t('signedAmount'),
        t('currencyLabel'),
        t('reversesReference'),
        t('correctionReason'),
      ],
      ...workspace.transactions
        .filter((row) => !memberFilter || row.member_id === memberFilter)
        .map((row) => [
          row.journal_id,
          workspace.members.find((m) => m.id === row.member_id)?.name ?? '',
          row.meeting_date,
          row.shares,
          row.amount,
          row.currency,
          row.reverses ?? '',
          row.note,
        ]),
    ];
    const url = URL.createObjectURL(
      new Blob([exportRows(data)], { type: 'text/csv;charset=utf-8;' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `yapesa-${selected}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const brand = (
    <a href="#overview" className="brand">
      <span className="brand-mark">
        <Icon name="leaf" size={25} />
      </span>
      <span>
        Yapesa<small>{t('brandDescriptor')}</small>
      </span>
    </a>
  );
  if (!session?.user)
    return (
      <div className="secure-login">
        <div className="login-brand">{brand}</div>
        <div className="login-card">
          <span className="subtle-tag">{t('savedWorkspace')}</span>
          <h1>{t('loginHeading')}</h1>
          <p>{t('loginDescription')}</p>
          {busy && <p role="status">{t('connectingSecurely')}</p>}
          {loading ? (
            <p role="status">{t('loadingRecords')}</p>
          ) : recovering ? (
            <RecoveryForm onCancel={() => setRecovering(false)} />
          ) : invitation ? (
            <InvitationForm
              onComplete={setSession}
              onCancel={() => setInvitation(false)}
            />
          ) : (
            <form onSubmit={signIn}>
              <div className="form-group">
                <label htmlFor="live-phone">{t('phoneNumber')}</label>
                <input
                  id="live-phone"
                  type="tel"
                  autoComplete="tel"
                  required
                  pattern="\+[1-9][0-9]{6,14}"
                  placeholder="+256…"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="live-pin">{t('pinLabel')}</label>
                <input
                  id="live-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  required
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
              </div>
              {session && !session.configured && (
                <p className="dialog-description">{t('authPreparing')}</p>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="button primary login-submit"
                disabled={busy || !session?.configured}
                type="submit"
              >
                {t('signIn')}
                <Icon name="arrow" size={17} />
              </button>
            </form>
          )}
          {!loading && !invitation && !recovering && session?.configured && (
            <button
              className="text-button signout-link"
              onClick={() => {
                setError('');
                setInvitation(true);
              }}
            >
              {t('firstTimeSetup')}
            </button>
          )}
          {!loading && !invitation && !recovering && session?.configured && (
            <button
              className="text-button signout-link"
              onClick={() => {
                setError('');
                setRecovering(true);
              }}
            >
              {t('forgotPin')}
            </button>
          )}
          <a className="back-link sample-link" href="#overview">
            {t('sampleWorkspace')}
          </a>
        </div>
        <p className="login-footer">{t('poweredBy')}</p>
      </div>
    );
  if (session.user.requires_mfa && !session.user.mfa_verified)
    return (
      <div className="secure-login">
        <div className="login-brand">{brand}</div>
        <div className="login-card">
          <h1>{t('secondFactor')}</h1>
          <p>{t('factorDescription')}</p>
          {busy && <p role="status">{t('connectingSecurely')}</p>}
          {!session.user.factors.length && !factor && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void handle(async () => {
                  setFactor(await api.enroll());
                })
              }
            >
              {t('setupAuthenticator')}
            </button>
          )}
          {factor && (
            <div className="factor-setup">
              <p>{t('setupDescription')}</p>
              <label>
                {t('setupKey')}
                <input
                  aria-label={t('setupKey')}
                  readOnly
                  value={factor.secret}
                />
              </label>
            </div>
          )}
          {(session.user.factors.length > 0 || factor) && (
            <form onSubmit={verify}>
              {session.user.factors.length > 1 && (
                <div className="form-group">
                  <label htmlFor="live-factor">{t('authenticator')}</label>
                  <select
                    id="live-factor"
                    value={factorId || session.user.factors[0]?.id}
                    onChange={(e) => setFactorId(e.target.value)}
                  >
                    {session.user.factors.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label htmlFor="live-code">{t('verificationCode')}</label>
                <input
                  id="live-code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  required
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <button className="button primary" type="submit" disabled={busy}>
                {t('verifyCode')}
              </button>
            </form>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="text-button signout-link"
            onClick={() => void signOut()}
            disabled={busy}
          >
            {t('signOut')}
          </button>
        </div>
      </div>
    );
  if (adminOpen && session.user.can_administer)
    return (
      <Administration
        onBack={() => {
          setAdminOpen(false);
          void handle(async () => {
            setSession(await api.session());
          });
        }}
      />
    );
  const rows =
    workspace?.transactions.filter(
      (row) =>
        (!memberFilter || row.member_id === memberFilter) &&
        `${workspace.members.find((m) => m.id === row.member_id)?.name ?? ''} ${row.id} ${row.note}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  const savedRows = workspace?.transactions ?? [];
  const inspectedTransaction = savedRows.find(
    (row) => row.journal_id === journal,
  );
  const inspectedReversal =
    inspectedTransaction &&
    savedRows.find((row) => row.reverses === inspectedTransaction.id);
  const total = savedRows.reduce((sum, row) => sum + BigInt(row.amount), 0n);
  const netShares = savedRows.reduce(
    (sum, row) => sum + BigInt(row.shares),
    0n,
  );
  const journalLines =
    workspace?.journal_lines.filter((line) => line.journal_id === journal) ??
    [];
  const matchingDebit = journalLines
    .filter((line) => line.side === 'debit')
    .reduce((sum, line) => sum + BigInt(line.amount), 0n);
  const matchingCredit = journalLines
    .filter((line) => line.side === 'credit')
    .reduce((sum, line) => sum + BigInt(line.amount), 0n);
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
        {brand}
        <div className="sidebar-workspace">
          <span className="workspace-avatar">
            {session.user.display_name.charAt(0)}
          </span>
          <span>
            <strong>{session.user.display_name}</strong>
            <small>{t('savedWorkspace')}</small>
          </span>
        </div>
        <nav aria-label={t('workspace')}>
          {(Object.keys(titleKeys) as Tab[]).map((key, index) => (
            <button
              className={`live-nav ${tab === key ? 'active' : ''}`}
              key={key}
              onClick={() => {
                setTab(key);
                setMemberFilter('');
                setMenu(false);
                setJournal(null);
                setSearch('');
              }}
            >
              <Icon
                name={
                  (['grid', 'calendar', 'people', 'ledger'] as const)[index]!
                }
              />
              {t(titleKeys[key])}
            </button>
          ))}
          {session.user.can_administer && (
            <button
              className="live-nav"
              onClick={() => {
                setMenu(false);
                setAdminOpen(true);
              }}
            >
              <Icon name="shield" />
              {t('administration')}
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="reset-link"
            disabled={busy}
            onClick={() => void signOut()}
          >
            {t('signOut')}
          </button>
          <a className="reset-link" href="#overview">
            {t('sampleWorkspace')}
          </a>
          <p className="powered">{t('poweredBy')}</p>
        </div>
      </aside>
      <div className="workspace-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label={t('openNavigation')}
            onClick={() => setMenu(true)}
          >
            <Icon name="menu" />
          </button>
          <span className="breadcrumb">
            {t('savedWorkspace')}
            <span>/</span>
            <strong>{t(titleKeys[tab])}</strong>
          </span>
          <span className="persistence">
            <span />
            {t('secureGroupStatus')}
          </span>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">{t('savedWorkspace')}</p>
              <h1>{workspace?.group.name ?? t('savedTitle')}</h1>
              <p className="page-subtitle">{t('savedDescription')}</p>
            </div>
            <div className="heading-actions">
              <button
                className="button"
                disabled={busy || !workspace}
                onClick={() => void exportPdf()}
              >
                <Icon name="download" size={17} />
                {t('exportPdf')}
              </button>
              <button
                className="button"
                disabled={busy || !workspace}
                onClick={exportCsv}
              >
                <Icon name="download" size={17} />
                {t('exportCsv')}
              </button>
              <button
                className="button"
                disabled={busy || !selected}
                onClick={() => void handle(() => refresh())}
              >
                <Icon name="reset" size={17} />
                {t('refreshRecords')}
              </button>
            </div>
          </div>
          {groups.length > 0 && (
            <div className="workspace-controls">
              <label className="group-select">
                <Icon name="people" size={17} />
                <select
                  value={selected}
                  disabled={busy || loading || Boolean(pending.current)}
                  aria-label={t('groupSelector')}
                  onChange={(e) => void chooseGroup(e.target.value)}
                >
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="persistence">
                <span />
                {t('databaseSaved')}
              </span>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {loading && (
            <p role="status" className="live-loading">
              {t('loadingRecords')}
            </p>
          )}
          {!loading && !groups.length && (
            <section className="panel empty-state">
              <Icon name="people" size={30} />
              <h2>{t('noGroups')}</h2>
              <p>{t('noGroupsHelp')}</p>
              <a className="button" href="#overview">
                {t('sampleWorkspace')}
              </a>
              {session.user.can_administer && (
                <button
                  className="button primary"
                  onClick={() => {
                    setMenu(false);
                    setAdminOpen(true);
                  }}
                >
                  {t('administration')}
                </button>
              )}
            </section>
          )}
          {workspace && (
            <>
              <div className="stats-grid live-stats">
                <section className="stat-card accent">
                  <span className="stat-top">{t('contributionsTotal')}</span>
                  <strong className="stat-value">
                    {amount(total, workspace)}
                  </strong>
                  <small>{t('allSavedRecords')}</small>
                </section>
                <section className="stat-card">
                  <span className="stat-top">{t('netShares')}</span>
                  <strong className="stat-value">{String(netShares)}</strong>
                  <small>{t('sharesLabel')}</small>
                </section>
                <section className="stat-card">
                  <span className="stat-top">{t('meetingsRecorded')}</span>
                  <strong className="stat-value">
                    {new Set(savedRows.map((row) => row.meeting_date)).size}
                  </strong>
                  <small>{workspace.group.currency}</small>
                </section>
              </div>
              {tab === 'overview' && (
                <div className="live-layout">
                  <section className="panel live-purchase">
                    <div className="panel-heading">
                      <div>
                        <h2>{t('newRecord')}</h2>
                        <p>{t('liveFormHelp')}</p>
                      </div>
                    </div>
                    {workspace.group.can_record && workspace.cycle ? (
                      <form onSubmit={save} className="live-form">
                        <div className="form-group">
                          <label htmlFor="saved-member">{t('member')}</label>
                          <select
                            id="saved-member"
                            required
                            value={member}
                            disabled={busy || Boolean(pending.current)}
                            onChange={(e) => {
                              setMember(e.target.value);
                              setReceipt(null);
                            }}
                          >
                            <option value="">{t('chooseMember')}</option>
                            {workspace.members
                              .filter((row) => row.active !== false)
                              .map((row) => (
                                <option value={row.id} key={row.id}>
                                  {row.name}
                                </option>
                              ))}
                          </select>
                        </div>
                        <div className="form-grid">
                          <div className="form-group">
                            <label htmlFor="saved-date">{t('dateLabel')}</label>
                            <input
                              id="saved-date"
                              type="date"
                              required
                              value={date}
                              min={workspace.cycle.starts_on}
                              max={workspace.cycle.ends_on}
                              disabled={busy || Boolean(pending.current)}
                              onChange={(e) => {
                                setDate(e.target.value);
                                setReceipt(null);
                              }}
                            />
                          </div>
                          <div className="form-group">
                            <label htmlFor="saved-shares">
                              {t('shareCount')}
                            </label>
                            <input
                              id="saved-shares"
                              type="number"
                              inputMode="numeric"
                              min="1"
                              step="1"
                              max={workspace.group.max_shares}
                              value={shares}
                              required
                              disabled={busy || Boolean(pending.current)}
                              onChange={(e) => {
                                setShares(e.target.value);
                                setReceipt(null);
                              }}
                            />
                          </div>
                        </div>
                        <div className="amount-preview">
                          <span>{t('calculatedAmount')}</span>
                          <strong>
                            {amount(
                              /^[1-9][0-9]{0,18}$/.test(shares)
                                ? BigInt(shares) *
                                    BigInt(workspace.cycle.share_price)
                                : 0n,
                              workspace,
                            )}
                          </strong>
                          <small>
                            {t('sharePrice')}:{' '}
                            {amount(workspace.cycle.share_price, workspace)}
                          </small>
                        </div>
                        <div className="form-group">
                          <label htmlFor="saved-note">{t('note')}</label>
                          <textarea
                            id="saved-note"
                            maxLength={240}
                            value={note}
                            disabled={busy || Boolean(pending.current)}
                            onChange={(e) => {
                              setNote(e.target.value);
                              setReceipt(null);
                            }}
                          />
                        </div>
                        <button
                          type="submit"
                          className="button primary"
                          disabled={busy}
                        >
                          {t(
                            busy
                              ? 'savingRecord'
                              : pending.current
                                ? 'retrySave'
                                : 'saveToGroup',
                          )}
                        </button>
                        {pending.current && !busy && !receipt && (
                          <p className="inline-warning">{t('pendingRetry')}</p>
                        )}
                        {receipt && (
                          <div className="saved-confirmation" role="status">
                            <Icon name="check" size={18} />
                            <div>
                              <strong>{t('savedRecord')}</strong>
                              <p>
                                {t('savedReference')}: {receipt.transaction_id}
                              </p>
                              {receipt.calculation_mismatch && (
                                <p>{t('flaggedRecord')}</p>
                              )}
                            </div>
                          </div>
                        )}
                      </form>
                    ) : (
                      <p className="live-readonly">
                        {t(workspace.cycle ? 'readOnlyRole' : 'noActiveCycle')}
                      </p>
                    )}
                  </section>
                  <section className="cycle-panel">
                    <span className="cycle-status">{t('activeCycle')}</span>
                    <h2>{workspace.group.name}</h2>
                    {workspace.cycle && (
                      <p>
                        {day(
                          workspace.cycle.starts_on,
                          workspace.group.time_zone,
                        )}{' '}
                        –{' '}
                        {day(
                          workspace.cycle.ends_on,
                          workspace.group.time_zone,
                        )}
                      </p>
                    )}
                    <div className="cycle-price">
                      <span>{t('currencyLabel')}</span>
                      <strong>{workspace.group.currency}</strong>
                    </div>
                    <div className="cycle-limit">
                      <span>{t('shareLimit')}</span>
                      <strong>{workspace.group.max_shares}</strong>
                    </div>
                    <div className="cycle-limit">
                      <span>{t('timezoneLabel')}</span>
                      <strong>{workspace.group.time_zone}</strong>
                    </div>
                  </section>
                </div>
              )}
              {tab === 'overview' && workspace.group.can_preview_shareout && (
                <ShareOutPreview
                  key={`${selected}-${savedRows.length}`}
                  group={selected}
                  format={(minor) => amount(minor, workspace)}
                />
              )}
              {tab === 'members' && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>{t('members')}</h2>
                  </div>
                  {workspace.members.map((row) => (
                    <button
                      className="record-row"
                      key={row.id}
                      onClick={() => {
                        setMemberFilter(row.id);
                        setTab('ledger');
                      }}
                    >
                      <span className="avatar">{row.name.charAt(0)}</span>
                      <span className="record-person">
                        <strong>{row.name}</strong>
                        <small>
                          {row.active === false
                            ? t('formerMember')
                            : t('viewPassbook')}
                        </small>
                      </span>
                      <Icon name="chevron" size={16} />
                    </button>
                  ))}
                </section>
              )}
              {tab === 'meetings' && workspace.group.can_preview_shareout && (
                <Meetings
                  key={selected}
                  group={selected}
                  person={session.user.person_id}
                  device={deviceId(selected)}
                  timeZone={workspace.group.time_zone}
                  cycle={workspace.cycle}
                  format={(minor) => amount(minor, workspace)}
                  onChanged={async () => {
                    setWorkspace(await api.workspace(selected));
                  }}
                />
              )}
              {tab === 'meetings' && !workspace.group.can_preview_shareout && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>{t('meetingRecords')}</h2>
                  </div>
                  {[...new Set(rows.map((row) => row.meeting_date))]
                    .sort()
                    .reverse()
                    .map((value) => (
                      <div className="meeting-row" key={value}>
                        <span className="calendar-tile">
                          <Icon name="calendar" size={19} />
                        </span>
                        <span className="meeting-title">
                          <strong>
                            {day(value, workspace.group.time_zone)}
                          </strong>
                          <small>
                            {
                              rows.filter((row) => row.meeting_date === value)
                                .length
                            }{' '}
                            {t('recordsLabel')}
                          </small>
                        </span>
                        <strong className="meeting-amount">
                          {amount(
                            rows
                              .filter((row) => row.meeting_date === value)
                              .reduce(
                                (sum, row) => sum + BigInt(row.amount),
                                0n,
                              ),
                            workspace,
                          )}
                        </strong>
                      </div>
                    ))}
                </section>
              )}
              {(tab === 'overview' || tab === 'ledger') && (
                <section className="panel live-records">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        {t(
                          memberFilter
                            ? 'passbook'
                            : tab === 'ledger'
                              ? 'ledger'
                              : 'recentRecords',
                        )}
                      </h2>
                      {memberFilter && (
                        <button
                          className="text-button"
                          onClick={() => setMemberFilter('')}
                        >
                          {t('showAllMembers')}
                        </button>
                      )}
                    </div>
                    <label className="search-field">
                      <Icon name="search" size={17} />
                      <input
                        type="search"
                        aria-label={t('searchRecords')}
                        placeholder={t('searchRecords')}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                  </div>
                  {rows.length ? (
                    rows.map((row) => (
                      <button
                        className="record-row"
                        key={row.id}
                        onClick={() => setJournal(row.journal_id)}
                      >
                        <span className="activity-icon">
                          <Icon name="arrow" size={17} />
                        </span>
                        <span className="record-person">
                          <strong>
                            {workspace.members.find(
                              (person) => person.id === row.member_id,
                            )?.name ?? t('member')}
                          </strong>
                          <small>
                            {day(row.meeting_date, workspace.group.time_zone)} ·{' '}
                            {row.reverses
                              ? t('reversalEntry')
                              : savedRows.some(
                                    (item) => item.reverses === row.id,
                                  )
                                ? t('reversedPurchase')
                                : row.calculation_mismatch
                                  ? t('flaggedRecord')
                                  : t('recorded')}
                          </small>
                        </span>
                        <span className="record-value">
                          <strong>{amount(row.amount, workspace)}</strong>
                          <small>
                            {row.shares} {t('sharesLabel')}
                          </small>
                        </span>
                        <Icon name="chevron" size={16} />
                      </button>
                    ))
                  ) : (
                    <div className="empty-state">
                      <h3>{t('noRecords')}</h3>
                    </div>
                  )}
                </section>
              )}
              {journal && (
                <section className="panel journal-inspector">
                  <div className="panel-heading">
                    <div>
                      <h2>{t('journalDetail')}</h2>
                      <p className="break-reference">{journal}</p>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={t('close')}
                      onClick={() => setJournal(null)}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                  <table className="journal-lines">
                    <thead>
                      <tr>
                        <th>{t('accountLabel')}</th>
                        <th>{t('debit')}</th>
                        <th>{t('credit')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {journalLines.map((line, index) => (
                        <tr key={index}>
                          <td>
                            {t(
                              line.account === 'cash'
                                ? 'cashAccount'
                                : 'sharesAccount',
                            )}
                          </td>
                          <td>
                            {line.side === 'debit'
                              ? amount(line.amount, workspace)
                              : '—'}
                          </td>
                          <td>
                            {line.side === 'credit'
                              ? amount(line.amount, workspace)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {matchingDebit === matchingCredit &&
                    journalLines.length >= 2 && (
                      <p className="balanced">
                        <Icon name="check" size={16} />
                        {t('balanced')}
                      </p>
                    )}
                  {inspectedTransaction && (
                    <>
                      <p>{inspectedTransaction.note}</p>
                      {inspectedTransaction.reverses ? (
                        <p className="break-reference">
                          {t('reversesReference')}:{' '}
                          {inspectedTransaction.reverses}
                        </p>
                      ) : inspectedReversal ? (
                        <p className="break-reference">
                          {t('reversedReference')}: {inspectedReversal.id}
                        </p>
                      ) : (
                        workspace.group.can_record && (
                          <ShareCorrection
                            key={inspectedTransaction.id}
                            group={selected}
                            transaction={inspectedTransaction.id}
                            device={deviceId(selected)}
                            onSaved={refresh}
                          />
                        )
                      )}
                    </>
                  )}
                </section>
              )}
            </>
          )}
          <footer className="workspace-footer">
            <span>Yapesa · {t('poweredBy')}</span>
            <span>{t('savedWorkspace')}</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
