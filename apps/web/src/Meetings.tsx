import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ClientError,
  newTransactionId,
  type MeetingCommand,
  type MeetingWorkspace,
} from '@yapesa/api-client';
import { t } from '@yapesa/i18n';
export default function Meetings({
  group,
  person,
  device,
  timeZone,
  cycle,
  format,
  onChanged,
}: {
  group: string;
  person: string;
  device: string;
  timeZone: string;
  cycle: { starts_on: string; ends_on: string } | null;
  format: (value: string) => string;
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<MeetingWorkspace | null>(null);
  const [selected, setSelected] = useState('');
  const [date, setDate] = useState(() => {
    const parts = new Map(
      new Intl.DateTimeFormat('en', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(new Date())
        .map((part) => [part.type, part.value]),
    );
    return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
  });
  const [counted, setCounted] = useState('');
  const [explanation, setExplanation] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const pending = useRef<MeetingCommand | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .meetings(group)
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setSelected(
            value.meetings
              .filter((row) => row.status === 'open')
              .sort((a, b) => a.date.localeCompare(b.date))[0]?.id ??
              value.meetings[0]?.id ??
              '',
          );
        }
      })
      .catch(() => {
        if (!cancelled) setError(t('meetingLoadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [group]);
  async function load(preferred?: string) {
    const value = await api.meetings(group);
    setData(value);
    setSelected(
      (current) =>
        preferred ??
        (value.meetings.some((row) => row.id === current)
          ? current
          : (value.meetings[0]?.id ?? '')),
    );
  }
  async function refresh() {
    setLoading(true);
    setError('');
    try {
      await load();
      await onChanged();
    } catch {
      setError(t('meetingLoadError'));
    } finally {
      setLoading(false);
    }
  }
  function input(
    action: MeetingCommand['action'],
    extra: Partial<MeetingCommand> = {},
  ): MeetingCommand {
    return {
      action,
      request_id: newTransactionId(),
      device_id: device,
      date: null,
      meeting_id: null,
      member_id: null,
      status: null,
      counted_cash: null,
      explanation: null,
      proposal_id: null,
      ...extra,
    };
  }
  async function save(command: MeetingCommand) {
    setBusy(true);
    setError('');
    setMessage('');
    pending.current = command;
    try {
      const result = await api.meetingCommand(group, command);
      pending.current = null;
      setMessage(t('meetingSaved'));
      try {
        await load(result.id);
        await onChanged();
      } catch {
        setError(t('meetingSavedRefresh'));
      }
    } catch (failure) {
      const rejected =
        failure instanceof ClientError &&
        failure.status >= 400 &&
        failure.status < 500;
      if (rejected) pending.current = null;
      setError(t(rejected ? 'meetingRejected' : 'meetingUncertain'));
    } finally {
      setBusy(false);
    }
  }
  const row = data?.meetings.find((item) => item.id === selected);
  const disabled = busy || loading || pending.current !== null;
  const proposal = row?.proposal;
  const alreadyApproved = proposal?.approvals.some(
    (item) => item.person_id === person,
  );
  const validCount =
    /^(0|[1-9][0-9]{0,18})$/.test(counted) &&
    BigInt(counted) <= 9223372036854775807n;
  const difference =
    validCount &&
    row?.expected_cash !== null &&
    row?.expected_cash !== undefined
      ? String(BigInt(counted) - BigInt(row.expected_cash))
      : null;
  function open(event: FormEvent) {
    event.preventDefault();
    void save(input('open', { date }));
  }
  function propose(event: FormEvent) {
    event.preventDefault();
    if (row)
      void save(
        input('propose', {
          meeting_id: row.id,
          counted_cash: counted,
          explanation: explanation.trim(),
        }),
      );
  }
  return (
    <section className="panel saved-meetings">
      <div className="panel-heading">
        <div>
          <h2>{t('onlineMeetingRecords')}</h2>
          <p>{t('meetingScope')}</p>
        </div>
        <button
          className="button secondary"
          disabled={disabled}
          onClick={() => void refresh()}
        >
          {t('refreshMeetings')}
        </button>
      </div>
      {loading && <p role="status">{t('loadingRecords')}</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {pending.current && !busy && (
        <button
          className="button primary"
          onClick={() => void save(pending.current!)}
        >
          {t('retryMeeting')}
        </button>
      )}
      {data?.can_record && cycle && (
        <form className="meeting-open-form" onSubmit={open}>
          <div className="form-group">
            <label htmlFor="new-meeting-date">{t('newMeetingDate')}</label>
            <input
              id="new-meeting-date"
              type="date"
              value={date}
              min={cycle.starts_on}
              max={cycle.ends_on}
              onChange={(event) => setDate(event.target.value)}
              disabled={disabled}
              required
            />
          </div>
          <button className="button primary" disabled={disabled} type="submit">
            {t('openMeeting')}
          </button>
        </form>
      )}
      {data && !data.meetings.length && <p>{t('noSavedMeetings')}</p>}
      {!!data?.meetings.length && (
        <div className="form-group">
          <label htmlFor="saved-meeting-picker">{t('chooseMeeting')}</label>
          <select
            id="saved-meeting-picker"
            value={selected}
            disabled={disabled}
            onChange={(event) => {
              setSelected(event.target.value);
              setCounted('');
              setExplanation('');
              setMessage('');
            }}
          >
            {data.meetings.map((item) => (
              <option key={item.id} value={item.id}>
                {item.date} ·{' '}
                {t(
                  item.status === 'closed'
                    ? 'meetingClosedLabel'
                    : 'meetingOpenLabel',
                )}
              </option>
            ))}
          </select>
        </div>
      )}
      {row && (
        <div className="meeting-detail">
          <h3>
            {row.date} ·{' '}
            {t(
              row.status === 'closed'
                ? 'meetingClosedLabel'
                : 'meetingOpenLabel',
            )}
          </h3>
          {row.status === 'closed' && (
            <p className="balanced" role="status">
              {t('meetingLocked')}
            </p>
          )}
          {row.opening_cash === null ? (
            <>
              <p>
                {t(
                  row.status === 'closed'
                    ? 'meetingLegacyClose'
                    : 'meetingNeedsOpening',
                )}
              </p>
              {data?.can_record && row.status === 'open' && (
                <button
                  className="button primary"
                  disabled={disabled}
                  onClick={() => void save(input('open', { date: row.date }))}
                >
                  {t('openSelectedMeeting')}
                </button>
              )}
            </>
          ) : (
            <>
              <p>{t('openingCashHelp')}</p>
              <dl className="meeting-cash">
                <div>
                  <dt>{t('openingCash')}</dt>
                  <dd>{format(row.opening_cash)}</dd>
                </div>
                <div>
                  <dt>{t('cashIn')}</dt>
                  <dd>{format(row.cash_in!)}</dd>
                </div>
                <div>
                  <dt>{t('cashOut')}</dt>
                  <dd>{format(row.cash_out!)}</dd>
                </div>
                <div>
                  <dt>{t('expectedClosingCash')}</dt>
                  <dd>{format(row.expected_cash!)}</dd>
                </div>
              </dl>
              <h3>{t('attendanceTitle')}</h3>
              <p>{t('attendanceHelp')}</p>
              <div className="meeting-attendance">
                {row.roster.map((member) => (
                  <div className="attendance-row" key={member.id}>
                    <label htmlFor={`attendance-${member.id}`}>
                      {member.name}
                    </label>
                    {data?.can_record && row.status === 'open' ? (
                      <select
                        id={`attendance-${member.id}`}
                        value={member.status ?? ''}
                        disabled={disabled}
                        onChange={(event) => {
                          if (event.target.value)
                            void save(
                              input('attendance', {
                                meeting_id: row.id,
                                member_id: member.id,
                                status: event.target.value as
                                  'present' | 'absent' | 'excused',
                              }),
                            );
                        }}
                      >
                        <option value="">{t('attendanceUnmarked')}</option>
                        <option value="present">
                          {t('attendancePresent')}
                        </option>
                        <option value="absent">{t('attendanceAbsent')}</option>
                        <option value="excused">
                          {t('attendanceExcused')}
                        </option>
                      </select>
                    ) : (
                      <span>
                        {t(
                          member.status === 'present'
                            ? 'attendancePresent'
                            : member.status === 'absent'
                              ? 'attendanceAbsent'
                              : member.status === 'excused'
                                ? 'attendanceExcused'
                                : 'attendanceUnmarked',
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {data?.can_record && row.status === 'open' && (
                <form className="meeting-close-form" onSubmit={propose}>
                  <h3>{t('prepareClosing')}</h3>
                  <p>{t('closingHelp')}</p>
                  <div className="form-group">
                    <label htmlFor="counted-closing-cash">
                      {t('countedClosingCash')}
                    </label>
                    <input
                      id="counted-closing-cash"
                      inputMode="numeric"
                      pattern="(0|[1-9][0-9]{0,18})"
                      maxLength={19}
                      value={counted}
                      onChange={(event) => setCounted(event.target.value)}
                      required
                      disabled={disabled}
                    />
                  </div>
                  {difference !== null && (
                    <p>
                      {t('cashDifference')}:{' '}
                      <strong>{format(difference)}</strong>
                    </p>
                  )}
                  <div className="form-group">
                    <label htmlFor="cash-explanation">
                      {t('cashExplanation')}
                    </label>
                    <textarea
                      id="cash-explanation"
                      value={explanation}
                      maxLength={500}
                      onChange={(event) => setExplanation(event.target.value)}
                      required={difference !== null && difference !== '0'}
                      disabled={disabled}
                    />
                  </div>
                  <button
                    className="button primary"
                    type="submit"
                    disabled={
                      disabled ||
                      !validCount ||
                      row.roster.some((member) => !member.status)
                    }
                  >
                    {t(proposal ? 'replaceClosing' : 'prepareClosing')}
                  </button>
                </form>
              )}
              {proposal && (
                <section
                  className="meeting-proposal"
                  aria-label={t('closingSnapshot')}
                >
                  <h3>{t('closingSnapshot')}</h3>
                  <dl className="meeting-cash">
                    <div>
                      <dt>{t('expectedClosingCash')}</dt>
                      <dd>{format(proposal.expected_cash)}</dd>
                    </div>
                    <div>
                      <dt>{t('countedClosingCash')}</dt>
                      <dd>{format(proposal.counted_cash)}</dd>
                    </div>
                    <div>
                      <dt>{t('cashDifference')}</dt>
                      <dd>{format(proposal.difference)}</dd>
                    </div>
                  </dl>
                  {proposal.explanation && <p>{proposal.explanation}</p>}
                  <p>
                    {t('officerApprovals')}:{' '}
                    {proposal.approvals.filter((item) => item.eligible).length}{' '}
                    / 2
                  </p>
                  <ul>
                    {proposal.approvals.map((item) => (
                      <li key={item.person_id}>
                        {item.name} ·{' '}
                        {t(
                          item.eligible
                            ? 'approvalRecorded'
                            : 'approvalRoleEnded',
                        )}
                      </li>
                    ))}
                  </ul>
                  {proposal.stale && row.status === 'open' && (
                    <p role="alert">{t('closingStale')}</p>
                  )}
                  {row.status === 'open' && data?.can_approve && (
                    <>
                      <p>{t('ownOfficerSignIn')}</p>
                      <button
                        className="button primary"
                        disabled={
                          disabled ||
                          !data?.can_approve ||
                          proposal.stale ||
                          alreadyApproved
                        }
                        onClick={() =>
                          void save(
                            input('approve', {
                              meeting_id: row.id,
                              proposal_id: proposal.id,
                            }),
                          )
                        }
                      >
                        {t(
                          alreadyApproved
                            ? 'alreadyApproved'
                            : 'approveClosing',
                        )}
                      </button>
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
