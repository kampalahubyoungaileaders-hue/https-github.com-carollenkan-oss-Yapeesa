import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ClientError,
  newTransactionId,
  type SocialWorkspace,
  type SocialCommand,
  type SocialRuleInput,
} from '@yapesa/api-client';
import { t } from '@yapesa/i18n';
import { exportRows } from './workspace';
type Rule = NonNullable<SocialWorkspace['rule']>;
type Pending =
  | { kind: 'rule'; body: SocialRuleInput }
  | { kind: 'record'; body: SocialCommand };
const roles = ['secretary', 'treasurer', 'chair'] as const;
function RuleForm({
  rule,
  busy,
  save,
}: {
  rule: Rule | null;
  busy: boolean;
  save: (
    value: Omit<SocialRuleInput, 'request_id' | 'device_id'>,
  ) => Promise<boolean>;
}) {
  const [amount, setAmount] = useState(rule?.contribution ?? '');
  const [selected, setSelected] = useState<string[]>(rule?.roles ?? []);
  const [separate, setSeparate] = useState(rule ? String(rule.separate) : '');
  const [required, setRequired] = useState(
    rule ? String(rule.require_all) : '',
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    await save({
      amount,
      roles: selected as SocialRuleInput['roles'],
      separate: separate === 'true',
      require_all: required === 'true',
    });
  }
  return (
    <form className="social-settings" onSubmit={(e) => void submit(e)}>
      <h3>{t('socialSettings')}</h3>
      <p>{t('socialSettingsHelp')}</p>
      <div className="form-group">
        <label htmlFor="social-rate">{t('socialRate')}</label>
        <input
          id="social-rate"
          required
          inputMode="numeric"
          pattern="[1-9][0-9]{0,18}"
          maxLength={19}
          value={amount}
          disabled={busy}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <fieldset disabled={busy}>
        <legend>{t('socialApproverRoles')}</legend>
        {roles.map((role) => (
          <label className="social-role" key={role}>
            <input
              type="checkbox"
              checked={selected.includes(role)}
              onChange={(e) =>
                setSelected((current) =>
                  e.target.checked
                    ? [...current, role]
                    : current.filter((value) => value !== role),
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
      <div className="form-group">
        <label htmlFor="social-separate">{t('socialSeparation')}</label>
        <select
          id="social-separate"
          required
          value={separate}
          disabled={busy}
          onChange={(e) => setSeparate(e.target.value)}
        >
          <option value="">{t('socialChoose')}</option>
          <option value="true">{t('socialDifferentOfficer')}</option>
          <option value="false">{t('socialAnyOfficer')}</option>
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="social-required">{t('socialRequired')}</label>
        <select
          id="social-required"
          required
          value={required}
          disabled={busy}
          onChange={(e) => setRequired(e.target.value)}
        >
          <option value="">{t('socialChoose')}</option>
          <option value="true">{t('socialAllRequired')}</option>
          <option value="false">{t('socialNotAllRequired')}</option>
        </select>
      </div>
      <button
        className="button primary"
        type="submit"
        disabled={busy || !selected.length}
      >
        {t('socialSaveSettings')}
      </button>
      {rule && (
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() =>
            void save({
              amount: null,
              roles: [],
              separate: rule.separate,
              require_all: rule.require_all,
            })
          }
        >
          {t('socialDisable')}
        </button>
      )}
    </form>
  );
}
export default function SocialFund({
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
  const [data, setData] = useState<SocialWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState('');
  const [contributor, setContributor] = useState('');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [correction, setCorrection] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const pending = useRef<Pending | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .social(group)
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setSelected(
            value.meetings
              .filter((m) => m.status === 'open' && m.ready)
              .sort((a, b) => a.date.localeCompare(b.date))[0]?.id ??
              value.meetings[0]?.id ??
              '',
          );
        }
      })
      .catch(() => {
        if (!cancelled) setError(t('socialLoadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [group]);
  async function load() {
    const value = await api.social(group);
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
      setError(t('socialLoadError'));
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
      if (input.kind === 'rule') await api.socialRule(group, input.body);
      else await api.socialCommand(group, input.body);
      pending.current = null;
      setMessage(t('socialSaved'));
      try {
        await load();
        await onChanged();
      } catch {
        setError(t('socialSavedRefresh'));
      }
      return true;
    } catch (failure) {
      const rejected =
        failure instanceof ClientError &&
        failure.status >= 400 &&
        failure.status < 500;
      if (rejected) pending.current = null;
      setError(t(rejected ? 'socialRejected' : 'socialUncertain'));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function command(
    action: SocialCommand['action'],
    extra: Partial<SocialCommand> = {},
  ): Pending {
    return {
      kind: 'record',
      body: {
        action,
        request_id: newTransactionId(),
        device_id: device,
        meeting_id: null,
        member_id: null,
        target_id: null,
        amount: null,
        reason: '',
        ...extra,
      },
    };
  }
  const frozen = busy || loading || pending.current !== null;
  const meeting = data?.meetings.find((m) => m.id === selected);
  const canRecord = Boolean(
    data?.can_record &&
    meeting?.status === 'open' &&
    meeting.ready &&
    meeting.started,
  );
  function contributed(id: string) {
    return (
      data?.transactions
        .filter((row) => row.meeting_id === selected && row.member_id === id)
        .reduce(
          (sum, row) =>
            sum +
            (row.kind === 'contribution' ||
            data.transactions.find((original) => original.id === row.reverses)
              ?.kind === 'contribution'
              ? BigInt(row.cash)
              : 0n),
          0n,
        ) ?? 0n
    );
  }
  async function contribution(e: FormEvent) {
    e.preventDefault();
    if (
      await mutate(
        command('contribute', { meeting_id: selected, member_id: contributor }),
      )
    )
      setContributor('');
  }
  async function grant(e: FormEvent) {
    e.preventDefault();
    if (
      await mutate(
        command('grant', {
          meeting_id: selected,
          member_id: recipient,
          amount,
          reason: reason.trim(),
        }),
      )
    ) {
      setRecipient('');
      setAmount('');
      setReason('');
    }
  }
  function csv() {
    if (!data) return;
    const rows = [
      [
        t('dateLabel'),
        t('member'),
        t('socialKind'),
        t('signedAmount'),
        t('currencyLabel'),
        t('journalRef'),
        t('reversesReference'),
        t('note'),
      ],
      ...data.transactions.map((row) => [
        row.date,
        row.name,
        t(
          row.kind === 'contribution'
            ? 'socialContribution'
            : row.kind === 'grant'
              ? 'socialGrant'
              : 'reversalEntry',
        ),
        row.cash,
        data.currency,
        row.journal_id,
        row.reverses ?? '',
        row.note,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob([exportRows(rows)], { type: 'text/csv;charset=utf-8;' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `yapesa-social-${group}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="panel social-panel">
      <div className="panel-heading">
        <div>
          <h2>{t('socialFund')}</h2>
          <p>{t('socialScope')}</p>
        </div>
        <button
          className="button secondary"
          disabled={frozen}
          onClick={() => void refresh()}
        >
          {t('socialRefresh')}
        </button>
      </div>
      {loading && <p role="status">{t('loadingRecords')}</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {pending.current && !busy && (
        <button
          className="button primary"
          onClick={() => void mutate(pending.current!)}
        >
          {t('socialRetry')}
        </button>
      )}
      {data && (
        <>
          {data.balance !== null && (
            <div className="social-balance">
              <span>{t('socialBalance')}</span>
              <strong>{format(data.balance)}</strong>
            </div>
          )}
          {data.can_configure && (
            <RuleForm
              key={data.rule?.id ?? 'none'}
              rule={data.rule}
              busy={frozen}
              save={(value) =>
                mutate({
                  kind: 'rule',
                  body: {
                    ...value,
                    request_id: newTransactionId(),
                    device_id: device,
                  },
                })
              }
            />
          )}
          {!data.rule && <p>{t('socialNotConfigured')}</p>}
          {!!data.meetings.length && (
            <div className="form-group">
              <label htmlFor="social-meeting">{t('socialMeeting')}</label>
              <select
                id="social-meeting"
                value={selected}
                disabled={frozen}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setContributor('');
                  setRecipient('');
                  setCorrection('');
                }}
              >
                {data.meetings.map((row) => (
                  <option value={row.id} key={row.id}>
                    {row.date} ·{' '}
                    {t(
                      row.status === 'closed'
                        ? 'meetingClosedLabel'
                        : 'meetingOpenLabel',
                    )}
                  </option>
                ))}
              </select>
            </div>
          )}
          {meeting && (
            <>
              {!meeting.ready && data.can_record && (
                <p>{t('socialOpenFirst')}</p>
              )}
              {meeting.started && (
                <>
                  <p>
                    {t('socialMeetingRate')}:{' '}
                    <strong>{format(meeting.contribution!)}</strong>.{' '}
                    {t('socialFrozenRule')}
                  </p>
                  <p>
                    {t('socialApproverRoles')}:{' '}
                    {meeting.roles
                      .map((role) =>
                        t(
                          role === 'secretary'
                            ? 'adminRoleSecretary'
                            : role === 'treasurer'
                              ? 'adminRoleTreasurer'
                              : 'adminRoleChair',
                        ),
                      )
                      .join(', ')}
                    .{' '}
                    {t(
                      meeting.separate
                        ? 'socialDifferentOfficer'
                        : 'socialAnyOfficer',
                    )}
                    .{' '}
                    {t(
                      meeting.require_all
                        ? 'socialAllRequired'
                        : 'socialNotAllRequired',
                    )}
                    .
                  </p>
                </>
              )}
              {data.can_record &&
                meeting.status === 'open' &&
                meeting.ready &&
                !meeting.started &&
                data.rule && (
                  <button
                    className="button primary"
                    disabled={frozen}
                    onClick={() =>
                      void mutate(command('start', { meeting_id: selected }))
                    }
                  >
                    {t('socialStart')}
                  </button>
                )}
              {canRecord && (
                <div className="social-forms">
                  <form onSubmit={(e) => void contribution(e)}>
                    <h3>{t('socialRecordContribution')}</h3>
                    <div className="form-group">
                      <label htmlFor="social-contributor">
                        {t('socialContributingMember')}
                      </label>
                      <select
                        id="social-contributor"
                        required
                        value={contributor}
                        disabled={frozen}
                        onChange={(e) => setContributor(e.target.value)}
                      >
                        <option value="">{t('socialMemberPlaceholder')}</option>
                        {members
                          .filter((m) => m.active)
                          .map((m) => (
                            <option
                              key={m.id}
                              value={m.id}
                              disabled={contributed(m.id) !== 0n}
                            >
                              {m.name}
                              {contributed(m.id) !== 0n
                                ? ` · ${t('recorded')}`
                                : ''}
                            </option>
                          ))}
                      </select>
                    </div>
                    <p>
                      {t('socialMeetingRate')}: {format(meeting.contribution!)}
                    </p>
                    <button
                      className="button primary"
                      disabled={
                        frozen ||
                        !contributor ||
                        contributed(contributor) !== 0n
                      }
                    >
                      {t('socialRecordContribution')}
                    </button>
                  </form>
                  <form onSubmit={(e) => void grant(e)}>
                    <h3>{t('socialRequestGrant')}</h3>
                    <p>{t('socialGrantHelp')}</p>
                    <div className="form-group">
                      <label htmlFor="social-recipient">
                        {t('socialRecipient')}
                      </label>
                      <select
                        id="social-recipient"
                        value={recipient}
                        required
                        disabled={frozen}
                        onChange={(e) => setRecipient(e.target.value)}
                      >
                        <option value="">{t('socialMemberPlaceholder')}</option>
                        {members
                          .filter((m) => m.active)
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor="social-grant-amount">
                        {t('socialGrantAmount')}
                      </label>
                      <input
                        id="social-grant-amount"
                        inputMode="numeric"
                        pattern="[1-9][0-9]{0,18}"
                        maxLength={19}
                        value={amount}
                        required
                        disabled={frozen}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor="social-grant-reason">
                        {t('socialReason')}
                      </label>
                      <textarea
                        id="social-grant-reason"
                        value={reason}
                        required
                        maxLength={240}
                        disabled={frozen}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </div>
                    <button
                      className="button primary"
                      disabled={frozen || !reason.trim()}
                    >
                      {t('socialRequestGrant')}
                    </button>
                  </form>
                </div>
              )}
            </>
          )}
          <h3>{t('socialRequests')}</h3>
          <p>{t('socialRequestsHelp')}</p>
          {data.requests.length ? (
            data.requests.map((row) => (
              <section className="social-request" key={row.id}>
                <h4>
                  {row.name} ·{' '}
                  {t(row.kind === 'grant' ? 'socialGrant' : 'socialCorrection')}
                </h4>
                <p>
                  {row.date} · <strong>{format(row.cash)}</strong> ·{' '}
                  {t(
                    row.outcome === 'approved'
                      ? 'approvalRecorded'
                      : row.outcome === 'cancelled'
                        ? 'socialCancelled'
                        : 'socialPending',
                  )}
                </p>
                <p>{row.reason}</p>
                {row.can_approve && (
                  <button
                    className="button primary"
                    disabled={frozen}
                    onClick={() =>
                      void mutate(command('approve', { target_id: row.id }))
                    }
                  >
                    {t('socialApproveRecord')}
                  </button>
                )}
                {data.can_record && row.outcome === null && (
                  <button
                    className="button secondary"
                    disabled={frozen}
                    onClick={() =>
                      void mutate(command('cancel', { target_id: row.id }))
                    }
                  >
                    {t('socialCancelRequest')}
                  </button>
                )}
              </section>
            ))
          ) : (
            <p>{t('socialNoRequests')}</p>
          )}
          <div className="panel-heading">
            <h3>{t('socialRecords')}</h3>
            <button
              className="button secondary"
              disabled={frozen || !data.transactions.length}
              onClick={csv}
            >
              {t('socialExport')}
            </button>
          </div>
          {!data.transactions.length && <p>{t('noRecords')}</p>}
          {data.transactions.map((row) => (
            <article className="social-entry" key={row.id}>
              <h4>
                {row.name} ·{' '}
                {t(
                  row.kind === 'contribution'
                    ? 'socialContribution'
                    : row.kind === 'grant'
                      ? 'socialGrant'
                      : 'reversalEntry',
                )}
              </h4>
              <p>
                {row.date} · <strong>{format(row.cash)}</strong>
              </p>
              <p>{row.note}</p>
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
                              : 'socialFund',
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
              {data.can_record &&
                row.kind !== 'reversal' &&
                data.meetings.find((m) => m.id === row.meeting_id)?.status ===
                  'open' &&
                !data.transactions.some((item) => item.reverses === row.id) && (
                  <button
                    className="text-button"
                    disabled={frozen}
                    onClick={() => {
                      setCorrection(row.id);
                      setCorrectionReason('');
                    }}
                  >
                    {t('socialRequestCorrection')}
                  </button>
                )}
              {correction === row.id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void mutate(
                      command('reverse', {
                        meeting_id: row.meeting_id,
                        target_id: row.id,
                        reason: correctionReason.trim(),
                      }),
                    ).then((saved) => {
                      if (saved) setCorrection('');
                    });
                  }}
                >
                  <p>{t('socialCorrectionHelp')}</p>
                  <div className="form-group">
                    <label htmlFor="social-correction-reason">
                      {t('correctionReason')}
                    </label>
                    <textarea
                      id="social-correction-reason"
                      value={correctionReason}
                      maxLength={240}
                      required
                      disabled={frozen}
                      onChange={(e) => setCorrectionReason(e.target.value)}
                    />
                  </div>
                  <button
                    className="button primary"
                    disabled={frozen || !correctionReason.trim()}
                  >
                    {t('socialSubmitCorrection')}
                  </button>
                </form>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
