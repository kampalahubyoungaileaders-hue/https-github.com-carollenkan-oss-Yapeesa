import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ClientError,
  newTransactionId,
  type LoanWorkspace,
  type LoanCommand,
  type LoanPolicyInput,
  type LoanQuote,
} from '@yapesa/api-client';
import {
  money,
  loanSchedule,
  allocateLoanPayment,
  type LoanTerms,
  type LoanAllocation,
} from '@yapesa/domain';
import { t } from '@yapesa/i18n';
import { exportRows } from './workspace';
type Terms = NonNullable<LoanPolicyInput['policy']>;
type Request = LoanWorkspace['requests'][number];
type Book = LoanWorkspace['loans'][number];
type Pending =
  | { kind: 'policy'; body: LoanPolicyInput }
  | { kind: 'record'; body: LoanCommand };
const roles = ['secretary', 'treasurer', 'chair'] as const;
function rateText(value: string) {
  const n = BigInt(value);
  return `${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
}
function rateBps(value: string) {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value))
    throw new Error('Invalid rate');
  const [whole, part = ''] = value.split('.');
  return String(BigInt(whole!) * 100n + BigInt(part.padEnd(2, '0')));
}
function domainTerms(r: Request): LoanTerms {
  return {
    months: BigInt(r.months),
    monthlyRateBps: BigInt(r.terms.monthly_rate_bps),
    method: r.terms.method,
    rounding: r.terms.rounding,
    allocation: r.terms.allocation,
    dates: r.terms.dates,
  };
}
function PolicyForm({
  policy,
  disabled,
  save,
}: {
  policy: Terms | null;
  disabled: boolean;
  save: (terms: Terms | null) => Promise<boolean>;
}) {
  const [rate, setRate] = useState(
    policy ? rateText(policy.monthly_rate_bps) : '',
  );
  const [form, setForm] = useState({
    method: policy?.method ?? '',
    multiple: policy?.multiple ?? '',
    max_months: policy?.max_months ?? '',
    rounding: policy?.rounding ?? '',
    allocation: policy?.allocation ?? '',
    dates: policy?.dates ?? '',
    separate: policy ? String(policy.separate) : '',
    approvals: policy?.approvals ?? '',
  });
  const [selected, setSelected] = useState<string[]>(policy?.roles ?? []);
  const choices = {
    method: [
      ['flat', 'loanFlat'],
      ['declining', 'loanDeclining'],
    ],
    rounding: [
      ['half_up', 'loanHalfUp'],
      ['down', 'loanDown'],
    ],
    allocation: [
      ['interest_first', 'loanInterestFirst'],
      ['principal_first', 'loanPrincipalFirst'],
    ],
    dates: [
      ['original_day', 'loanOriginalDay'],
      ['month_end', 'loanMonthEnd'],
    ],
    separate: [
      ['true', 'loanSeparateYes'],
      ['false', 'loanSeparateNo'],
    ],
    approvals: [
      ['1', '1'],
      ['2', '2'],
      ['3', '3'],
    ],
  } as const;
  const labels = {
    method: 'loanMethod',
    rounding: 'loanRounding',
    allocation: 'loanAllocation',
    dates: 'loanDates',
    separate: 'loanSeparate',
    approvals: 'loanApprovalCount',
  } as const;
  async function submit(e: FormEvent) {
    e.preventDefault();
    await save({
      ...form,
      monthly_rate_bps: rateBps(rate),
      roles: selected,
      separate: form.separate === 'true',
    } as Terms);
  }
  return (
    <form className="social-settings" onSubmit={(e) => void submit(e)}>
      <h3>{t('loanSettings')}</h3>
      <p>{t('loanSettingsHelp')}</p>
      <p>{t('loanTermsHelp')}</p>
      <fieldset disabled={disabled}>
        <label className="form-group">
          {t('loanRate')}
          <input
            required
            inputMode="decimal"
            pattern="[0-9]+([.][0-9]{1,2})?"
            maxLength={10}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </label>
        {(() => {
          try {
            return BigInt(rateBps(rate)) > 1000n ? (
              <p role="note">{t('loanHighRate')}</p>
            ) : null;
          } catch {
            return null;
          }
        })()}
        <label className="form-group">
          {t('loanMultiple')}
          <input
            required
            inputMode="numeric"
            pattern="[1-9][0-9]{0,18}"
            maxLength={19}
            value={form.multiple}
            onChange={(e) => setForm({ ...form, multiple: e.target.value })}
          />
        </label>
        <label className="form-group">
          {t('loanMaxMonths')}
          <input
            required
            inputMode="numeric"
            pattern="[1-9][0-9]{0,2}"
            maxLength={3}
            value={form.max_months}
            onChange={(e) => setForm({ ...form, max_months: e.target.value })}
          />
        </label>
        {(Object.keys(choices) as (keyof typeof choices)[]).map((key) => (
          <label className="form-group" key={key}>
            {t(labels[key])}
            <select
              aria-label={t(labels[key])}
              required
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            >
              <option value="">{t('socialChoose')}</option>
              {choices[key].map(([value, label]) => (
                <option key={value} value={value}>
                  {key === 'approvals'
                    ? label
                    : t(label as Exclude<typeof label, '1' | '2' | '3'>)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <fieldset>
          <legend>{t('loanRoles')}</legend>
          {roles.map((role) => (
            <label className="social-role" key={role}>
              <input
                type="checkbox"
                checked={selected.includes(role)}
                onChange={(e) =>
                  setSelected((current) =>
                    e.target.checked
                      ? [...current, role]
                      : current.filter((r) => r !== role),
                  )
                }
              />
              {t(
                role === 'secretary'
                  ? 'adminRoleSecretary'
                  : role === 'treasurer'
                    ? 'adminRoleTreasurer'
                    : 'adminRoleChair',
              )}
            </label>
          ))}
        </fieldset>
        <div className="button-row">
          <button
            className="button primary"
            disabled={!selected.length}
            type="submit"
          >
            {t('loanSaveSettings')}
          </button>
          {policy && (
            <button
              className="button secondary"
              type="button"
              onClick={() => void save(null)}
            >
              {t('loanDisable')}
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
function TermsSummary({ terms }: { terms: Terms }) {
  return (
    <p>
      {t('loanMonthlyRateLabel')}: {rateText(terms.monthly_rate_bps)}% ·{' '}
      {t(terms.method === 'flat' ? 'loanFlat' : 'loanDeclining')} ·{' '}
      {t(terms.rounding === 'half_up' ? 'loanHalfUp' : 'loanDown')} ·{' '}
      {t(
        terms.allocation === 'interest_first'
          ? 'loanInterestFirst'
          : 'loanPrincipalFirst',
      )}{' '}
      · {t(terms.dates === 'original_day' ? 'loanOriginalDay' : 'loanMonthEnd')}
    </p>
  );
}
function Schedule({
  rows,
  format,
  paid,
}: {
  rows: LoanQuote['schedule'];
  format: (minor: string) => string;
  paid?: (period: string) => { principal: string; interest: string };
}) {
  return (
    <div className="loan-table-wrap">
      <table aria-label={t('loanSchedule')}>
        <thead>
          <tr>
            <th>{t('loanPeriod')}</th>
            <th>{t('loanDue')}</th>
            <th>{t('loanPrincipalLabel')}</th>
            <th>{t('loanInterestLabel')}</th>
            {paid && (
              <>
                <th>{t('loanPrincipalPaid')}</th>
                <th>{t('loanInterestPaid')}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.period}>
              <td>{r.period}</td>
              <td>{r.due}</td>
              <td>{format(r.principal)}</td>
              <td>{format(r.interest)}</td>
              {paid && (
                <>
                  <td>{format(paid(r.period).principal)}</td>
                  <td>{format(paid(r.period).interest)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export default function Loans({
  group,
  device,
  members,
  format,
  onChanged,
}: {
  group: string;
  device: string;
  members: { id: string; name: string; active: boolean }[];
  format: (value: string) => string;
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<LoanWorkspace | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [selected, setSelected] = useState('');
  const [borrower, setBorrower] = useState(''),
    [principal, setPrincipal] = useState(''),
    [months, setMonths] = useState(''),
    [reason, setReason] = useState(''),
    [quote, setQuote] = useState<LoanQuote | null>(null);
  const [action, setAction] = useState<{
      kind: 'disburse' | 'cancel' | 'repay' | 'reverse';
      id: string;
      name: string;
    } | null>(null),
    [cash, setCash] = useState(''),
    [actionReason, setActionReason] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const pending = useRef<Pending | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .loans(group)
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setSelected(
            value.meetings.find((m) => m.status === 'open' && m.ready)?.id ??
              value.meetings[0]?.id ??
              '',
          );
        }
      })
      .catch(() => {
        if (!cancelled) setError(t('loanLoadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [group]);
  async function load() {
    const value = await api.loans(group);
    setData(value);
    setQuote(null);
    setSelected((current) =>
      value.meetings.some((m) => m.id === current)
        ? current
        : (value.meetings.find((m) => m.status === 'open' && m.ready)?.id ??
          value.meetings[0]?.id ??
          ''),
    );
  }
  async function refresh() {
    setLoading(true);
    setError('');
    try {
      await load();
      await onChanged();
    } catch {
      setError(t('loanLoadError'));
    } finally {
      setLoading(false);
    }
  }
  async function mutate(input: Pending) {
    setBusy(true);
    setError('');
    setMessage('');
    pending.current = input;
    try {
      if (input.kind === 'policy') await api.loanPolicy(group, input.body);
      else await api.loanCommand(group, input.body);
      pending.current = null;
      setAction(null);
      setMessage(
        t(input.kind === 'policy' ? 'loanSettingsSaved' : 'loanSaved'),
      );
      try {
        await load();
        await onChanged();
      } catch {
        setError(t('loanSavedRefresh'));
      }
      return true;
    } catch (failure) {
      const rejected =
        failure instanceof ClientError &&
        failure.status >= 400 &&
        failure.status < 500;
      if (rejected) pending.current = null;
      setError(t(rejected ? 'loanRejected' : 'loanUncertain'));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function command(
    kind: LoanCommand['action'],
    extra: Partial<LoanCommand> = {},
  ): Pending {
    return {
      kind: 'record',
      body: {
        request_id: newTransactionId(),
        device_id: device,
        action: kind,
        meeting_id: selected,
        member_id: null,
        target_id: null,
        policy_id: null,
        amount: null,
        months: null,
        reason: '',
        ...extra,
      },
    };
  }
  async function preview(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setQuote(null);
    try {
      setQuote(
        await api.loanQuote(group, {
          member_id: borrower,
          meeting_id: selected,
          principal,
          months,
        }),
      );
    } catch {
      setError(t('loanRejected'));
    } finally {
      setBusy(false);
    }
  }
  function choose(
    kind: NonNullable<typeof action>['kind'],
    id: string,
    name: string,
  ) {
    setAction({ kind, id, name });
    setCash('');
    setActionReason('');
    setConfirmed(false);
  }
  const meeting = data?.meetings.find((m) => m.id === selected),
    open = Boolean(meeting?.status === 'open' && meeting.ready),
    record = Boolean(open && data?.can_record),
    frozen = loading || busy || pending.current !== null;
  const req = data?.requests.find((r) => r.id === action?.id),
    book = data?.loans.find((r) => r.id === action?.id),
    event = data?.events.find((e) => e.id === action?.id);
  function scheduleFor(r: Request, date: string) {
    return loanSchedule(
      money(BigInt(r.principal), data!.currency),
      date,
      domainTerms(r),
    ).map((i) => ({
      period: i.period,
      due: i.due,
      principal: String(i.principal.minor),
      interest: String(i.interest.minor),
    }));
  }
  function paymentPreview(b: Book) {
    if (!data || !cash) return null;
    try {
      const r = data.requests.find((r) => r.id === b.request_id)!;
      const schedule = loanSchedule(
        money(BigInt(r.principal), data.currency),
        b.date,
        domainTerms(r),
      );
      const paid: LoanAllocation[] = data.events
        .filter((e) => e.loan_id === b.id)
        .flatMap((e) =>
          e.allocations.map((a) => ({
            period: a.period,
            principal: money(
              (e.cash.startsWith('-') ? -1n : 1n) * BigInt(a.principal),
              data.currency,
            ),
            interest: money(
              (e.cash.startsWith('-') ? -1n : 1n) * BigInt(a.interest),
              data.currency,
            ),
          })),
        );
      const allocations = allocateLoanPayment(
        schedule,
        paid,
        money(BigInt(cash), data.currency),
        r.terms.allocation,
      );
      return {
        principal: String(
          allocations.reduce((s, a) => s + a.principal.minor, 0n),
        ),
        interest: String(
          allocations.reduce((s, a) => s + a.interest.minor, 0n),
        ),
      };
    } catch {
      return null;
    }
  }
  const split = action?.kind === 'repay' && book ? paymentPreview(book) : null;
  function paidAmounts(id: string, period: string) {
    let p = 0n,
      i = 0n;
    for (const e of data?.events ?? [])
      if (e.loan_id === id)
        for (const a of e.allocations)
          if (a.period === period) {
            const sign = e.cash.startsWith('-') ? -1n : 1n;
            p += sign * BigInt(a.principal);
            i += sign * BigInt(a.interest);
          }
    return { principal: String(p), interest: String(i) };
  }
  function download(rows: string[][], name: string) {
    const url = URL.createObjectURL(
      new Blob([exportRows(rows)], { type: 'text/csv;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="panel social-panel loans-panel">
      <div className="panel-heading">
        <h2>{t('loansTitle')}</h2>
        <button
          className="button secondary"
          disabled={frozen}
          onClick={() => void refresh()}
        >
          {t('loansRefresh')}
        </button>
      </div>
      <p>{t('loansHelp')}</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {pending.current && !busy && (
        <button
          className="button primary"
          onClick={() => {
            if (pending.current) void mutate(pending.current);
          }}
        >
          {t('loanRetry')}
        </button>
      )}
      {data && (
        <>
          {data.can_configure && (
            <details className="loan-settings">
              <summary>{t('loanSettings')}</summary>
              <PolicyForm
                key={JSON.stringify(data.policy)}
                policy={data.policy?.terms ?? null}
                disabled={frozen}
                save={(policy) =>
                  mutate({
                    kind: 'policy',
                    body: {
                      request_id: newTransactionId(),
                      device_id: device,
                      policy,
                    },
                  })
                }
              />
            </details>
          )}
          <label className="form-group">
            {t('loanMeeting')}
            <select
              aria-label={t('loanMeeting')}
              value={selected}
              disabled={frozen}
              onChange={(e) => {
                setSelected(e.target.value);
                setQuote(null);
                setAction(null);
              }}
            >
              <option value="">{t('socialChoose')}</option>
              {data.meetings.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.date} ·{' '}
                  {t(
                    m.status === 'open'
                      ? 'meetingOpenLabel'
                      : 'meetingClosedLabel',
                  )}
                </option>
              ))}
            </select>
          </label>
          {meeting?.available_cash !== null &&
            meeting?.available_cash !== undefined && (
              <div className="social-balance">
                <span>{t('loanAvailable')}</span>
                <strong>{format(meeting.available_cash)}</strong>
              </div>
            )}
          {!open && <p>{t('loanChooseOpen')}</p>}
          {!data.can_record && <p>{t('loanReadOnly')}</p>}
          {!data.policy && <p>{t('loanNoPolicy')}</p>}
          {record && data.policy && (
            <form
              className="social-settings loan-request-form"
              onSubmit={(e) => void preview(e)}
            >
              <h3>{t('loanRequestTitle')}</h3>
              <TermsSummary terms={data.policy.terms} />
              <p>{t('loanTermsHelp')}</p>
              <fieldset disabled={frozen}>
                <label className="form-group">
                  {t('loanBorrower')}
                  <select
                    aria-label={t('loanBorrower')}
                    required
                    value={borrower}
                    onChange={(e) => {
                      setBorrower(e.target.value);
                      setQuote(null);
                    }}
                  >
                    <option value="">{t('socialChoose')}</option>
                    {members
                      .filter((m) => m.active)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="form-group">
                  {t('loanPrincipal')}
                  <input
                    required
                    inputMode="numeric"
                    pattern="[1-9][0-9]{0,18}"
                    maxLength={19}
                    value={principal}
                    onChange={(e) => {
                      setPrincipal(e.target.value);
                      setQuote(null);
                    }}
                  />
                </label>
                <label className="form-group">
                  {t('loanMonths')}
                  <input
                    required
                    inputMode="numeric"
                    pattern="[1-9][0-9]{0,2}"
                    maxLength={3}
                    value={months}
                    onChange={(e) => {
                      setMonths(e.target.value);
                      setQuote(null);
                    }}
                  />
                </label>
                <label className="form-group">
                  {t('loanReason')}
                  <input
                    maxLength={240}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button className="button secondary" type="submit">
                  {t('loanPreview')}
                </button>
                {quote && (
                  <div className="loan-quote">
                    <p>
                      {t('loanBorrowable')}:{' '}
                      <strong>{format(quote.borrowable)}</strong>
                    </p>
                    <p>
                      {t('loanTotalInterest')}:{' '}
                      <strong>
                        {format(
                          String(
                            quote.schedule.reduce(
                              (sum, r) => sum + BigInt(r.interest),
                              0n,
                            ),
                          ),
                        )}
                      </strong>
                    </p>
                    <Schedule rows={quote.schedule} format={format} />
                    <button
                      className="button primary"
                      disabled={
                        !reason.trim() ||
                        BigInt(principal) > BigInt(quote.borrowable)
                      }
                      type="button"
                      onClick={() =>
                        void mutate(
                          command('request', {
                            member_id: borrower,
                            amount: principal,
                            months,
                            policy_id: quote.policy_id,
                            reason,
                          }),
                        )
                      }
                    >
                      {t('loanSaveRequest')}
                    </button>
                  </div>
                )}
              </fieldset>
            </form>
          )}
          {action && record && (
            <form
              className="social-settings loan-action"
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(
                  command(action.kind, {
                    target_id: action.id,
                    amount: action.kind === 'repay' ? cash : null,
                    reason: actionReason,
                  }),
                );
              }}
            >
              <h3>
                {t(
                  action.kind === 'disburse'
                    ? 'loanReviewDisburse'
                    : action.kind === 'repay'
                      ? 'loanReviewRepayment'
                      : action.kind === 'cancel'
                        ? 'loanCancelRequest'
                        : 'loanReverse',
                )}{' '}
                · {action.name}
              </h3>
              <fieldset disabled={frozen}>
                {action.kind === 'disburse' && req && meeting && (
                  <>
                    <p>{t('loanDisburseHelp')}</p>
                    <p>
                      {t('loanPrincipalLabel')}:{' '}
                      <strong>{format(req.principal)}</strong>
                    </p>
                    <TermsSummary terms={req.terms} />
                    <Schedule
                      rows={scheduleFor(req, meeting.date)}
                      format={format}
                    />
                  </>
                )}
                {action.kind === 'repay' && (
                  <>
                    <label className="form-group">
                      {t('loanRepaymentAmount')}
                      <input
                        required
                        inputMode="numeric"
                        pattern="[1-9][0-9]{0,18}"
                        maxLength={19}
                        value={cash}
                        onChange={(e) => setCash(e.target.value)}
                      />
                    </label>
                    {split && (
                      <p>
                        {t('loanPaymentSplit')}: {t('loanPrincipalLabel')}{' '}
                        {format(split.principal)} · {t('loanInterestLabel')}{' '}
                        {format(split.interest)}
                      </p>
                    )}
                  </>
                )}
                {action.kind === 'reverse' && event && (
                  <>
                    <p>{t('loanCorrectionHelp')}</p>
                    <p>
                      {t('signedAmount')}:{' '}
                      <strong>{format(String(-BigInt(event.cash)))}</strong>
                    </p>
                  </>
                )}
                <label className="form-group">
                  {t('loanReason')}
                  <input
                    required
                    maxLength={240}
                    pattern=".*\S.*"
                    value={actionReason}
                    onChange={(e) => setActionReason(e.target.value)}
                  />
                </label>
                {action.kind !== 'cancel' && (
                  <label className="loan-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    {t(
                      action.kind === 'disburse'
                        ? 'loanConfirmCashOut'
                        : action.kind === 'repay'
                          ? 'loanConfirmCashIn'
                          : 'loanConfirmCorrection',
                    )}
                  </label>
                )}
                <div className="button-row">
                  <button
                    className="button primary"
                    type="submit"
                    disabled={
                      (action.kind !== 'cancel' && !confirmed) ||
                      (action.kind === 'repay' && !split)
                    }
                  >
                    {t(
                      action.kind === 'disburse'
                        ? 'loanDisburse'
                        : action.kind === 'repay'
                          ? 'loanSavePayment'
                          : action.kind === 'cancel'
                            ? 'loanCancelRequest'
                            : 'loanSaveCorrection',
                    )}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setAction(null)}
                  >
                    {t('fineCancel')}
                  </button>
                </div>
              </fieldset>
            </form>
          )}
          <h3>{t('loanRequests')}</h3>
          {!data.requests.length && <p>{t('loanNoRequests')}</p>}
          {data.requests.map((r) => (
            <article className="social-entry loan-request" key={r.id}>
              <h4>
                {r.name} · {format(r.principal)}
              </h4>
              <p>
                {r.months} {t('loanMonthUnit')} · {r.date}
              </p>
              <TermsSummary terms={r.terms} />
              <p>
                {t('loanTotalInterest')}:{' '}
                <strong>
                  {format(
                    String(
                      scheduleFor(r, r.date).reduce(
                        (sum, i) => sum + BigInt(i.interest),
                        0n,
                      ),
                    ),
                  )}
                </strong>{' '}
                · {t('loanTotal')}:{' '}
                <strong>
                  {format(
                    String(
                      BigInt(r.principal) +
                        scheduleFor(r, r.date).reduce(
                          (sum, i) => sum + BigInt(i.interest),
                          0n,
                        ),
                    ),
                  )}
                </strong>
              </p>
              <details>
                <summary>{t('loanSchedule')}</summary>
                <p>{t('loanIndicativeDates')}</p>
                <Schedule rows={scheduleFor(r, r.date)} format={format} />
              </details>
              <p>{r.reason}</p>
              <p>
                {t('loanApprovedCount')}:{' '}
                {r.approvals.filter((a) => a.eligible).length}/
                {r.terms.approvals}
              </p>
              {r.cancelled ? (
                <p>{t('loanCancelled')}</p>
              ) : r.loan_id ? (
                <p>
                  {t(
                    data.loans.find((b) => b.id === r.loan_id)?.cancelled
                      ? 'loanReversed'
                      : 'loanDisbursed',
                  )}
                </p>
              ) : (
                <div className="button-row">
                  {open && r.can_approve && (
                    <button
                      className="button primary"
                      disabled={frozen}
                      onClick={() =>
                        void mutate(command('approve', { target_id: r.id }))
                      }
                    >
                      {t('loanApprove')}
                    </button>
                  )}
                  {record && (
                    <>
                      <button
                        className="button secondary"
                        disabled={
                          frozen ||
                          BigInt(r.approvals.filter((a) => a.eligible).length) <
                            BigInt(r.terms.approvals)
                        }
                        onClick={() => choose('disburse', r.id, r.name)}
                      >
                        {t('loanReviewDisburse')}
                      </button>
                      <button
                        className="button secondary"
                        disabled={frozen}
                        onClick={() => choose('cancel', r.id, r.name)}
                      >
                        {t('loanCancelRequest')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </article>
          ))}
          <div className="panel-heading">
            <h3>{t('loanBook')}</h3>
            <button
              className="button secondary"
              disabled={frozen || !data.loans.length}
              onClick={() =>
                download(
                  [
                    [
                      t('fineReference'),
                      t('fineCurrency'),
                      t('loanBorrower'),
                      t('fineDate'),
                      t('loanPrincipalLabel'),
                      t('loanTotalInterest'),
                      t('loanPrincipalRemaining'),
                      t('loanInterestRemaining'),
                    ],
                    ...data.loans.map((b) => [
                      b.id,
                      data.currency,
                      b.name,
                      b.date,
                      data.requests.find((r) => r.id === b.request_id)!
                        .principal,
                      String(
                        b.schedule.reduce(
                          (sum, r) => sum + BigInt(r.interest),
                          0n,
                        ),
                      ),
                      b.principal_remaining,
                      b.interest_remaining,
                    ]),
                  ],
                  'yapesa-loan-book.csv',
                )
              }
            >
              {t('loanExport')}
            </button>
          </div>
          {!data.loans.length && <p>{t('loanNoLoans')}</p>}
          {data.loans.map((b) => (
            <article className="social-entry loan-book-entry" key={b.id}>
              <h4>{b.name}</h4>
              <p>
                {t('loanPrincipalRemaining')}:{' '}
                <strong>{format(b.principal_remaining)}</strong>
              </p>
              <p>
                {t('loanInterestRemaining')}:{' '}
                <strong>{format(b.interest_remaining)}</strong>
              </p>
              {b.cancelled ? (
                <p>{t('loanReversed')}</p>
              ) : b.principal_remaining === '0' &&
                b.interest_remaining === '0' ? (
                <p>{t('loanRepaid')}</p>
              ) : (
                record && (
                  <button
                    className="button primary"
                    disabled={frozen}
                    onClick={() => choose('repay', b.id, b.name)}
                  >
                    {t('loanReviewRepayment')}
                  </button>
                )
              )}
              <details>
                <summary>{t('loanSchedule')}</summary>
                <Schedule
                  rows={b.schedule}
                  format={format}
                  paid={(period) => paidAmounts(b.id, period)}
                />
              </details>
            </article>
          ))}
          <div className="panel-heading">
            <h3>{t('loanHistory')}</h3>
            <button
              className="button secondary"
              disabled={frozen || !data.events.length}
              onClick={() =>
                download(
                  [
                    [
                      t('fineReference'),
                      t('fineCurrency'),
                      t('fineDate'),
                      t('loanReference'),
                      t('loanPrincipalLabel'),
                      t('loanInterestLabel'),
                      t('signedAmount'),
                      t('reversesReference'),
                      t('fineJournalReference'),
                      t('loanReason'),
                    ],
                    ...data.events.map((e) => [
                      e.id,
                      data.currency,
                      e.date,
                      e.loan_id,
                      e.principal,
                      e.interest,
                      e.cash,
                      e.reverses ?? '',
                      e.journal_id,
                      e.reason,
                    ]),
                  ],
                  'yapesa-loan-cash.csv',
                )
              }
            >
              {t('loanHistoryExport')}
            </button>
          </div>
          {[...data.events].reverse().map((e) => (
            <article className="social-entry loan-event" key={e.id}>
              <h4>
                {data.loans.find((b) => b.id === e.loan_id)?.name} ·{' '}
                {t(
                  e.kind === 'disbursement'
                    ? 'loanMovementDisburse'
                    : e.kind === 'repayment'
                      ? 'loanMovementRepayment'
                      : 'loanMovementReversal',
                )}
              </h4>
              <p>
                {e.date} · <strong>{format(e.cash)}</strong>
              </p>
              <p>{e.reason}</p>
              <details>
                <summary>{t('socialJournal')}</summary>
                <table>
                  <thead>
                    <tr>
                      <th>{t('accountLabel')}</th>
                      <th>{t('debit')}</th>
                      <th>{t('credit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.journal.map((l) => (
                      <tr key={l.account}>
                        <td>
                          {t(
                            l.account === 'cash'
                              ? 'cashAccount'
                              : l.account === 'loans_receivable'
                                ? 'loanReceivableAccount'
                                : 'loanInterestAccount',
                          )}
                        </td>
                        <td>{l.side === 'debit' ? format(l.amount) : '—'}</td>
                        <td>{l.side === 'credit' ? format(l.amount) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
              {record &&
                e.meeting_id === selected &&
                e.kind !== 'reversal' &&
                !data.events.some((r) => r.reverses === e.id) && (
                  <button
                    className="button secondary"
                    disabled={frozen}
                    onClick={() =>
                      choose(
                        'reverse',
                        e.id,
                        data.loans.find((b) => b.id === e.loan_id)?.name ?? '',
                      )
                    }
                  >
                    {t('loanReverse')}
                  </button>
                )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
