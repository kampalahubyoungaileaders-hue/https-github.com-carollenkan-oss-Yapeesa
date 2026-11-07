import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ClientError,
  newTransactionId,
  type FineWorkspace,
  type FineCommand,
  type FinePolicyInput,
} from '@yapesa/api-client';
import { t } from '@yapesa/i18n';
import { exportRows } from './workspace';
type Rule = FinePolicyInput['rules'][number];
type Draft = Omit<Rule, 'trigger' | 'partial'> & {
  trigger: '' | Rule['trigger'];
  partial: '' | 'true' | 'false';
};
type Pending =
  | { kind: 'policy'; body: FinePolicyInput }
  | { kind: 'record'; body: FineCommand };
function Settings({
  rules,
  disabled,
  save,
}: {
  rules: Rule[];
  disabled: boolean;
  save: (rules: Rule[]) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<Draft[]>(
    rules.map((r) => ({
      ...r,
      partial: String(r.partial) as 'true' | 'false',
    })),
  );
  function change(index: number, patch: Partial<Draft>) {
    setRows((current) =>
      current.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (rows.some((r) => !r.trigger || !r.partial)) return;
    await save(
      rows.map((r) => ({
        ...r,
        trigger: r.trigger as Rule['trigger'],
        partial: r.partial === 'true',
      })),
    );
  }
  return (
    <form className="social-settings" onSubmit={(e) => void submit(e)}>
      <h3>{t('finesSettings')}</h3>
      <p>{t('finesSettingsHelp')}</p>
      <fieldset disabled={disabled}>
        {rows.map((row, i) => (
          <fieldset className="fine-rule" key={i}>
            <legend>
              {t('fineType')} {i + 1}
            </legend>
            <label className="form-group">
              {t('fineCode')}
              <input
                required
                pattern="[a-z][a-z0-9_-]{0,39}"
                maxLength={40}
                value={row.code}
                onChange={(e) => change(i, { code: e.target.value })}
              />
            </label>
            <label className="form-group">
              {t('fineName')}
              <input
                required
                maxLength={80}
                value={row.name}
                onChange={(e) => change(i, { name: e.target.value })}
              />
            </label>
            <label className="form-group">
              {t('fineAmount')}
              <input
                required
                inputMode="numeric"
                pattern="[1-9][0-9]{0,18}"
                maxLength={19}
                value={row.amount}
                onChange={(e) => change(i, { amount: e.target.value })}
              />
            </label>
            <label className="form-group">
              {t('fineTrigger')}
              <select
                required
                value={row.trigger}
                onChange={(e) =>
                  change(i, { trigger: e.target.value as Draft['trigger'] })
                }
              >
                <option value="">{t('socialChoose')}</option>
                <option value="manual">{t('fineManual')}</option>
                <option value="absence">{t('fineAbsence')}</option>
              </select>
            </label>
            <label className="form-group">
              {t('finePartial')}
              <select
                required
                value={row.partial}
                onChange={(e) =>
                  change(i, { partial: e.target.value as Draft['partial'] })
                }
              >
                <option value="">{t('socialChoose')}</option>
                <option value="true">{t('finePartialYes')}</option>
                <option value="false">{t('finePartialNo')}</option>
              </select>
            </label>
            <button
              className="button secondary"
              type="button"
              onClick={() =>
                setRows((current) => current.filter((_, j) => j !== i))
              }
            >
              {t('fineRemove')}
            </button>
          </fieldset>
        ))}
        <div className="button-row">
          <button
            type="button"
            className="button secondary"
            disabled={rows.length >= 20}
            onClick={() =>
              setRows((current) => [
                ...current,
                { code: '', name: '', amount: '', trigger: '', partial: '' },
              ])
            }
          >
            {t('fineAdd')}
          </button>
          <button type="submit" className="button primary">
            {t('fineSave')}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
export default function Fines({
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
  const [data, setData] = useState<FineWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState('');
  const [member, setMember] = useState('');
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [action, setAction] = useState<{
    kind: 'pay' | 'waive' | 'reverse';
    id: string;
    name: string;
    due: string;
    partial: boolean;
  } | null>(null);
  const [cash, setCash] = useState('');
  const [actionReason, setActionReason] = useState('');
  const pending = useRef<Pending | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .fines(group)
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
        if (!cancelled) setError(t('finesLoadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [group]);
  async function load() {
    const value = await api.fines(group);
    setData(value);
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
      setError(t('finesLoadError'));
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
      if (input.kind === 'policy') await api.finePolicy(group, input.body);
      else await api.fineCommand(group, input.body);
      pending.current = null;
      setAction(null);
      setMessage(t('finesSaved'));
      try {
        await load();
        await onChanged();
      } catch {
        setError(t('finesSavedRefresh'));
      }
      return true;
    } catch (failure) {
      const rejected =
        failure instanceof ClientError &&
        failure.status >= 400 &&
        failure.status < 500;
      if (rejected) pending.current = null;
      setError(t(rejected ? 'finesRejected' : 'finesUncertain'));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function command(
    kind: FineCommand['action'],
    extra: Partial<FineCommand>,
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
        code: null,
        amount: null,
        reason: '',
        ...extra,
      },
    };
  }
  const frozen = loading || busy || pending.current !== null;
  const meeting = data?.meetings.find((m) => m.id === selected);
  const canRecord = Boolean(
    data?.can_record && meeting?.status === 'open' && meeting.ready,
  );
  const manual = meeting?.rules.filter((r) => r.trigger === 'manual') ?? [];
  const due = data?.charges.reduce((sum, r) => sum + BigInt(r.due), 0n) ?? 0n;
  const paid = data?.events.reduce((sum, r) => sum + BigInt(r.cash), 0n) ?? 0n;
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
  function choose(
    kind: 'pay' | 'waive' | 'reverse',
    id: string,
    name: string,
    remaining: string,
    partial = false,
  ) {
    setAction({ kind, id, name, due: remaining, partial });
    setCash(remaining);
    setActionReason('');
  }
  return (
    <section className="panel social-panel fines-panel">
      <div className="panel-heading">
        <h2>{t('finesTitle')}</h2>
        <button
          className="button secondary"
          disabled={frozen}
          onClick={() => void refresh()}
        >
          {t('finesRefresh')}
        </button>
      </div>
      <p>{t('finesHelp')}</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {pending.current && !busy && (
        <button
          className="button primary"
          onClick={() => {
            if (pending.current) void mutate(pending.current);
          }}
        >
          {t('finesRetry')}
        </button>
      )}
      {data && (
        <>
          <div className="fine-balances">
            <div className="social-balance">
              <span>{t('fineOutstanding')}</span>
              <strong>{format(String(due))}</strong>
            </div>
            <div className="social-balance">
              <span>{t('fineCollected')}</span>
              <strong>{format(String(paid))}</strong>
            </div>
          </div>
          {data.can_configure && (
            <details className="fine-settings">
              <summary>{t('finesSettings')}</summary>
              <Settings
                key={JSON.stringify(data.rules)}
                rules={data.rules}
                disabled={frozen}
                save={(rules) =>
                  mutate({
                    kind: 'policy',
                    body: {
                      request_id: newTransactionId(),
                      device_id: device,
                      rules,
                    },
                  })
                }
              />
            </details>
          )}
          <label className="form-group">
            {t('finesMeeting')}
            <select
              value={selected}
              disabled={frozen}
              onChange={(e) => {
                setSelected(e.target.value);
                setCode('');
                setAction(null);
              }}
            >
              <option value="">{t('socialChoose')}</option>
              {data.meetings.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.date} ·{' '}
                  {m.status === 'open'
                    ? t('meetingOpenLabel')
                    : t('meetingClosedLabel')}
                </option>
              ))}
            </select>
          </label>
          {meeting && (
            <>
              <p>{t('finesRuleHelp')}</p>
              {meeting.rules.length ? (
                <ul aria-label={t('fineRuleList')}>
                  {meeting.rules.map((r) => (
                    <li key={r.code}>
                      {r.name}: {format(r.amount)} ·{' '}
                      {t(
                        r.trigger === 'absence' ? 'fineAbsence' : 'fineManual',
                      )}{' '}
                      · {t(r.partial ? 'finePartialYes' : 'finePartialNo')}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t('finesNoRules')}</p>
              )}
            </>
          )}
          {!canRecord && (
            <p>{t(data.can_record ? 'finesClosed' : 'finesReadOnly')}</p>
          )}
          {canRecord && manual.length > 0 && (
            <form
              className="social-settings"
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(
                  command('assess', { member_id: member, code, reason }),
                ).then((saved) => {
                  if (saved) setReason('');
                });
              }}
            >
              <h3>{t('fineAssess')}</h3>
              <fieldset disabled={frozen}>
                <label className="form-group">
                  {t('fineMember')}
                  <select
                    required
                    value={member}
                    onChange={(e) => setMember(e.target.value)}
                  >
                    <option value="">{t('socialChoose')}</option>
                    {members
                      .filter((m) => m.active)
                      .map((m) => (
                        <option value={m.id} key={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="form-group">
                  {t('fineType')}
                  <select
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  >
                    <option value="">{t('socialChoose')}</option>
                    {manual.map((r) => (
                      <option value={r.code} key={r.code}>
                        {r.name} · {format(r.amount)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-group">
                  {t('fineReason')}
                  <input
                    required
                    pattern=".*\S.*"
                    maxLength={240}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button className="button primary" type="submit">
                  {t('fineApply')}
                </button>
              </fieldset>
            </form>
          )}
          {action && canRecord && (
            <form
              className="social-settings fine-action"
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(
                  command(action.kind, {
                    target_id: action.id,
                    amount: action.kind === 'pay' ? cash : null,
                    reason: actionReason,
                  }),
                );
              }}
            >
              <h3>
                {t(
                  action.kind === 'pay'
                    ? 'finePay'
                    : action.kind === 'waive'
                      ? 'fineWaive'
                      : 'fineReverse',
                )}{' '}
                · {action.name}
              </h3>
              <p>
                {t(
                  action.kind === 'pay'
                    ? 'finePaymentHelp'
                    : action.kind === 'waive'
                      ? 'fineWaiverHelp'
                      : 'fineReverseHelp',
                )}
              </p>
              <fieldset disabled={frozen}>
                {action.kind === 'pay' && (
                  <label className="form-group">
                    {t('finePaymentAmount')}
                    <input
                      required
                      inputMode="numeric"
                      pattern="[1-9][0-9]{0,18}"
                      maxLength={19}
                      readOnly={!action.partial}
                      value={cash}
                      onChange={(e) => setCash(e.target.value)}
                    />
                  </label>
                )}
                <label className="form-group">
                  {t('fineReason')}
                  <input
                    required
                    pattern=".*\S.*"
                    maxLength={240}
                    value={actionReason}
                    onChange={(e) => setActionReason(e.target.value)}
                  />
                </label>
                <div className="button-row">
                  <button className="button primary" type="submit">
                    {t('fineConfirm')}
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setAction(null)}
                  >
                    {t('fineCancel')}
                  </button>
                </div>
              </fieldset>
            </form>
          )}
          <div className="panel-heading">
            <h3>{t('fineCharges')}</h3>
            <button
              className="button secondary"
              disabled={!data.charges.length || frozen}
              onClick={() =>
                download(
                  [
                    [
                      t('fineReference'),
                      t('fineCurrency'),
                      t('fineMember'),
                      t('fineDate'),
                      t('fineType'),
                      t('fineAmount'),
                      t('finePaid'),
                      t('fineWaived'),
                      t('fineDue'),
                      t('fineReason'),
                    ],
                    ...data.charges.map((r) => [
                      r.id,
                      data.currency,
                      r.name,
                      r.date,
                      r.fine,
                      r.amount,
                      r.paid,
                      r.waived,
                      r.due,
                      r.reason,
                    ]),
                  ],
                  'yapesa-fines.csv',
                )
              }
            >
              {t('fineExport')}
            </button>
          </div>
          {!data.charges.length && <p>{t('fineNoCharges')}</p>}
          {data.charges.map((row) => (
            <article className="social-record social-entry" key={row.id}>
              <h4>
                {row.name} · {row.fine}
              </h4>
              <p>
                {row.date} · {format(row.amount)}
              </p>
              <p>
                {row.reason}
                {row.automatic && <> · {t('fineAutomatic')}</>}
              </p>
              <p>
                {t('finePaid')}: {format(row.paid)} · {t('fineWaived')}:{' '}
                {format(row.waived)} ·{' '}
                <strong>
                  {t('fineDue')}: {format(row.due)}
                </strong>
              </p>
              {canRecord &&
                row.due !== '0' &&
                row.date <= (meeting?.date ?? '') && (
                  <div className="button-row">
                    <button
                      className="button secondary"
                      disabled={frozen}
                      onClick={() =>
                        choose('pay', row.id, row.name, row.due, row.partial)
                      }
                    >
                      {t('finePay')}
                    </button>
                    <button
                      className="button secondary"
                      disabled={frozen}
                      onClick={() => choose('waive', row.id, row.name, row.due)}
                    >
                      {t('fineWaive')}
                    </button>
                  </div>
                )}
            </article>
          ))}
          <div className="panel-heading">
            <h3>{t('fineHistory')}</h3>
            <button
              className="button secondary"
              disabled={!data.events.length || frozen}
              onClick={() =>
                download(
                  [
                    [
                      t('fineReference'),
                      t('fineCurrency'),
                      t('fineMember'),
                      t('fineDate'),
                      t('fineType'),
                      t('signedAmount'),
                      t('fineWaived'),
                      t('fineReason'),
                      t('fineChargeReference'),
                      t('fineJournalReference'),
                      t('reversesReference'),
                    ],
                    ...data.events.map((r) => [
                      r.id,
                      data.currency,
                      r.name,
                      r.date,
                      r.kind,
                      r.cash,
                      r.waived,
                      r.reason,
                      r.charge_id,
                      r.journal_id ?? '',
                      r.reverses ?? '',
                    ]),
                  ],
                  'yapesa-fine-history.csv',
                )
              }
            >
              {t('fineHistoryExport')}
            </button>
          </div>
          {data.events.map((row) => (
            <article className="social-record social-entry" key={row.id}>
              <h4>
                {row.name} ·{' '}
                {t(
                  row.kind === 'payment'
                    ? 'finePaymentKind'
                    : row.kind === 'reversal'
                      ? 'fineReversalKind'
                      : 'fineWaiverKind',
                )}
              </h4>
              <p>
                {row.date} ·{' '}
                {format(row.kind === 'waiver' ? row.waived : row.cash)}
              </p>
              <p>{row.reason}</p>
              {row.journal.length > 0 && (
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
                      {row.journal.map((line) => (
                        <tr key={line.account}>
                          <td>
                            {t(
                              line.account === 'cash'
                                ? 'cashAccount'
                                : 'fineIncomeAccount',
                            )}
                          </td>
                          <td>
                            {line.side === 'debit' ? format(line.amount) : '—'}
                          </td>
                          <td>
                            {line.side === 'credit' ? format(line.amount) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
              {canRecord &&
                row.kind === 'payment' &&
                row.meeting_id === selected &&
                !data.events.some((e) => e.reverses === row.id) && (
                  <button
                    className="button secondary"
                    disabled={frozen}
                    onClick={() =>
                      choose(
                        'reverse',
                        row.id,
                        row.name,
                        String(-BigInt(row.cash)),
                      )
                    }
                  >
                    {t('fineReverse')}
                  </button>
                )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
