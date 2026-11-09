import { useEffect, useState, type FormEvent } from 'react';
import {
  api,
  type ProgrammeList,
  type ProgrammeReport,
} from '@yapesa/api-client';
import { t } from '@yapesa/i18n';
import { exportRows } from './workspace';
function amount(value: string, currency: string, digits: number) {
  const n = BigInt(value),
    scale = 10n ** BigInt(digits),
    a = n < 0n ? -n : n;
  return `${n < 0n ? '−' : ''}${currency} ${new Intl.NumberFormat('en-UG').format(a / scale)}${digits ? '.' + String(a % scale).padStart(digits, '0') : ''}`;
}
export default function ProgrammeReports({
  choices,
  onBack,
}: {
  choices: ProgrammeList;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState(choices[0]?.id ?? ''),
    [asOf, setAsOf] = useState(''),
    [data, setData] = useState<ProgrammeReport | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [filter, setFilter] = useState('all');
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setData(null);
    setError('');
    void api
      .programmeReport(selected)
      .then((v) => {
        if (alive) {
          setData(v);
          setAsOf(v.as_of);
        }
      })
      .catch(() => {
        if (alive) setError(t('programmeError'));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [selected]);
  async function refresh(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setData(null);
    try {
      setData(await api.programmeReport(selected, asOf));
    } catch {
      setError(t('programmeError'));
    } finally {
      setBusy(false);
    }
  }
  function csv() {
    if (!data) return;
    const rows: string[][] = [
      [
        'Programme ID',
        'Programme',
        'As of',
        'Programme time zone',
        'Group ID',
        'Group',
        'Status',
        'Currency',
        'Minor unit digits',
        'Group time zone',
        'Report section',
        'Period',
        'Members / roster',
        'Present',
        'Absent',
        'Excused',
        'Unmarked',
        'Share contributions (minor units)',
        'Outstanding principal (minor units)',
        'Arrears (minor units)',
        'Scheduled due (minor units)',
        'Net repayments (minor units)',
        'Last meeting',
        'Days since meeting',
        'Meeting attention',
        'Repayment attention',
        'Arrears 1-30',
        'Arrears 31-60',
        'Arrears 61-90',
        'Arrears over 90',
      ],
    ];
    for (const g of data.groups) {
      const common = [
        data.id,
        data.name,
        data.as_of,
        data.time_zone,
        g.id,
        g.name,
        g.status,
        g.currency,
        String(g.minor_digits),
        g.time_zone,
      ];
      rows.push([
        ...common,
        'Group summary',
        '',
        g.members,
        '',
        '',
        '',
        '',
        g.share_contributions,
        g.outstanding_principal,
        g.arrears,
        '',
        '',
        g.last_meeting ?? '',
        g.days_since_meeting ?? '',
        String(g.meeting_attention),
        String(g.repayment_attention),
        g.ageing.days_1_30,
        g.ageing.days_31_60,
        g.ageing.days_61_90,
        g.ageing.days_over_90,
      ]);
      for (const m of g.trends)
        rows.push([
          ...common,
          'Monthly trend',
          m.month,
          m.roster,
          m.present,
          m.absent,
          m.excused,
          String(
            BigInt(m.roster) -
              BigInt(m.present) -
              BigInt(m.absent) -
              BigInt(m.excused),
          ),
          m.shares,
          '',
          '',
          m.scheduled_due,
          m.repayments,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ]);
    }
    const url = URL.createObjectURL(
        new Blob([exportRows(rows)], { type: 'text/csv;charset=utf-8' }),
      ),
      a = document.createElement('a');
    a.href = url;
    a.download = `yapesa-programme-${data.id}-${data.as_of}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const groups =
    data?.groups.filter(
      (g) =>
        filter === 'all' ||
        (filter === 'meetings' ? g.meeting_attention : g.repayment_attention),
    ) ?? [];
  return (
    <main className="administration programme-workspace">
      <header className="panel-heading">
        <h1>{t('programmeTitle')}</h1>
        <button className="button secondary" onClick={onBack}>
          {t('programmeBack')}
        </button>
      </header>
      <p>{t('programmeHelp')}</p>
      <p>{t('programmePrivacy')}</p>
      <form className="programme-filters" onSubmit={(e) => void refresh(e)}>
        <div className="form-group">
          <label htmlFor="programme-select">{t('programmeChoose')}</label>
          <select
            id="programme-select"
            disabled={busy}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="programme-date">{t('programmeAsOf')}</label>
          <input
            id="programme-date"
            type="date"
            min="2000-01-01"
            max="2099-12-31"
            required
            disabled={busy}
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </div>
        <button className="button primary" disabled={busy}>
          {t('programmeRefresh')}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">{t('programmeLoading')}</p>}
      {data && (
        <>
          <h2>{data.name}</h2>
          <p>
            {data.as_of} · {data.time_zone}
          </p>
          <p>{t('programmeScope')}</p>
          <div className="programme-summary">
            <div className="admin-card">
              <strong>
                {data.groups.filter((g) => g.meeting_attention).length}
              </strong>
              <span>{t('programmeMeetingAttention')}</span>
            </div>
            <div className="admin-card">
              <strong>
                {data.groups.filter((g) => g.repayment_attention).length}
              </strong>
              <span>{t('programmeRepaymentAttention')}</span>
            </div>
            <div className="admin-card">
              <strong>{data.groups.length}</strong>
              <span>{t('programmeAllGroups')}</span>
            </div>
          </div>
          <section className="admin-card">
            <h2>{t('programmeTotals')}</h2>
            {data.currencies.map((c) => (
              <p key={c.currency}>
                {c.currency} · {t('programmeOutstanding')}:{' '}
                {amount(c.outstanding_principal, c.currency, c.minor_digits)} ·{' '}
                {t('programmeArrears')}:{' '}
                {amount(c.arrears, c.currency, c.minor_digits)} ·{' '}
                {t('programmeShares')}:{' '}
                {amount(c.share_contributions, c.currency, c.minor_digits)}
              </p>
            ))}
          </section>
          <div className="panel-heading">
            <div className="form-group">
              <label htmlFor="programme-filter">
                {t('programmeAttentionFilter')}
              </label>
              <select
                id="programme-filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">{t('programmeAllGroups')}</option>
                <option value="meetings">{t('programmeMeetingFilter')}</option>
                <option value="repayments">
                  {t('programmeRepaymentFilter')}
                </option>
              </select>
            </div>
            <button className="button secondary" onClick={csv}>
              {t('programmeExport')}
            </button>
          </div>
          {!data.groups.length && <p>{t('programmeNoGroups')}</p>}
          {data.groups.length > 0 && !groups.length && (
            <p>{t('programmeNoMatches')}</p>
          )}
          {groups.map((g) => (
            <article className="admin-card programme-group" key={g.id}>
              <h2>{g.name}</h2>
              <p>{g.id}</p>
              <p>
                {g.status === 'inactive'
                  ? t('programmeInactive')
                  : [
                      g.meeting_attention ? t('programmeMeetingFilter') : '',
                      g.repayment_attention
                        ? t('programmeRepaymentFilter')
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || t('programmeNoIssues')}
              </p>
              <dl>
                <dt>{t('programmeLastMeeting')}</dt>
                <dd>
                  {g.last_meeting ?? t('programmeNeverMet')}
                  {g.days_since_meeting === null
                    ? ''
                    : ` (${g.days_since_meeting} ${t('programmeDays')})`}
                </dd>
                <dt>{t('programmeMembers')}</dt>
                <dd>{g.members}</dd>
                <dt>{t('programmeShares')}</dt>
                <dd>
                  {amount(g.share_contributions, g.currency, g.minor_digits)}
                </dd>
                <dt>{t('programmeOutstanding')}</dt>
                <dd>
                  {amount(g.outstanding_principal, g.currency, g.minor_digits)}
                </dd>
                <dt>{t('programmeArrears')}</dt>
                <dd>
                  {amount(g.arrears, g.currency, g.minor_digits)} ·{' '}
                  {g.loans_in_arrears}
                </dd>
              </dl>
              <h3>{t('programmeAgeing')}</h3>
              {(
                [
                  ['days_1_30', 'programmeDays1'],
                  ['days_31_60', 'programmeDays31'],
                  ['days_61_90', 'programmeDays61'],
                  ['days_over_90', 'programmeDays90'],
                ] as const
              ).map(([k, label]) => (
                <p key={k}>
                  {t(label)}: {amount(g.ageing[k], g.currency, g.minor_digits)}
                </p>
              ))}
              <details>
                <summary>{t('programmeTrend')}</summary>
                <div className="programme-trends">
                  {g.trends.map((m) => (
                    <section className="programme-month" key={m.month}>
                      <h4>{m.month.slice(0, 7)}</h4>
                      <p>
                        {t('programmeMeetings')}: {m.meetings}
                      </p>
                      <p>
                        {t('programmePresent')}: {m.present} / {m.roster}
                      </p>
                      <p>
                        {t('programmeAbsent')}: {m.absent} ·{' '}
                        {t('programmeExcused')}: {m.excused} ·{' '}
                        {t('programmeUnmarked')}:{' '}
                        {String(
                          BigInt(m.roster) -
                            BigInt(m.present) -
                            BigInt(m.absent) -
                            BigInt(m.excused),
                        )}
                      </p>
                      <p>
                        {t('programmeScheduled')}:{' '}
                        {amount(m.scheduled_due, g.currency, g.minor_digits)}
                      </p>
                      <p>
                        {t('programmeRepaid')}:{' '}
                        {amount(m.repayments, g.currency, g.minor_digits)}
                      </p>
                      <p>
                        {t('programmeShares')}:{' '}
                        {amount(m.shares, g.currency, g.minor_digits)}
                      </p>
                    </section>
                  ))}
                </div>
              </details>
            </article>
          ))}
        </>
      )}
    </main>
  );
}
